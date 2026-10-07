/**
 * Chiffrement multiniveau du « format Apex » (en-tête chiffré du G-code et journal des
 * modifications, CDC_INTEGRATION_NOEUDS.md D4, D5, D7 ; format : docs/APEX_HEADER_FORMAT.md).
 *
 * CE N'EST PAS UNE PROTECTION. Le projet est open source : toutes les clés, tables et réglages
 * ci-dessous sont publics. La raison de ce chiffrement est la publicité (un format fermé en
 * apparence sur un système ouvert fait parler), jamais la sécurité ; ne jamais le présenter comme tel.
 *
 * Étages, dans l'ordre décidé par l'utilisateur :
 *   1. grand chiffre de Louis XIV — nomenclateur : octets et digrammes → codes à 3 chiffres ;
 *      (compression deflate des chiffres, codage et non chiffrement, recommandée pour la taille)
 *   2. AES-256-GCM (clé 1) ;
 *   3. chiffre de Vigénère — sur des lettres (chaque octet → deux lettres A–P) ;
 *   4. grille de Fleissner 8 × 8 (transposition par blocs de 64 lettres, bourrage « X ») ;
 *   5. Enigma I (rotors I-II-III, réflecteur B, tableau de connexions) ;
 *   6. AES-256-GCM (clé 2).
 * Sortie : base64 de « APX1 » ‖ nonce 2 ‖ chiffré 2.
 */

const MAGIC = new Uint8Array([0x41, 0x50, 0x58, 0x31]); // « APX1 »
const NONCE_BYTES = 12;

// --- clés publiques (format, pas secret) ---------------------------------------------------------

const hexBytes = (hex: string) => Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16)));
const AES_KEY_1 = hexBytes('4170657820537563726520466f726d617420312d204c6f756973205849562121');
const AES_KEY_2 = hexBytes('4165656c6f782048617264776172652d417065782d466f726d61742d32303236');
const VIGENERE_KEY = 'ROSSIGNOLGRANDCHIFFRE';

// --- 1. grand chiffre (nomenclateur Apex, inspiré de celui des Rossignol) ---------------------------

// Digrammes : syllabes fréquentes du français, et motifs fréquents du texte du journal (JSON,
// nombres). Avec les 256 octets seuls, la table tient sous 1000 codes (3 chiffres).
const DIGRAMS: string[] = (() => {
  const french = ('es le de en re nt on er te ou an la et ne se qu ur it ai is me ti ra ce ue ie ar in au ll ns eu co pa pr ' +
    'ca ch ma po st ta tr ve sa mo lo io ro al el em ri ui ss tt om di ge ni so pe vi li si ea ec ta ux ot un us ' +
    'ac ag ec ic il ir ol or ul').split(' ');
  const json = ['":', '",', '{"', '"}', '[[', ']]', '],', '[', ',"', '":[', '0.', '.0', '-0', 'e-', 'nu', 'll'];
  const digits: string[] = [];
  for (let i = 0; i < 100; i++) digits.push(String(i).padStart(2, '0'));
  const list = [...new Set([...french, ...json.filter((s) => s.length === 2), ...digits])];
  return list.filter((s) => s.length === 2);
})();

/** PRNG déterministe (mulberry32) pour les tables : les mêmes de partout, documentées. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOMENCLATOR = (() => {
  const entries: number[][] = [];
  for (let b = 0; b < 256; b++) entries.push([b]);
  for (const d of DIGRAMS) entries.push([d.charCodeAt(0), d.charCodeAt(1)]);
  const codes = Array.from({ length: 1000 }, (_, i) => i);
  const random = mulberry32(1666); // graine fixe du format v1
  for (let i = codes.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [codes[i], codes[j]] = [codes[j], codes[i]];
  }
  const encode = new Map<number, number>(); // clé : octet (0–255) ou 256 + 256·a + b pour un digramme
  const decode = new Map<number, number[]>();
  entries.forEach((e, i) => {
    const key = e.length === 1 ? e[0] : 256 + e[0] * 256 + e[1];
    encode.set(key, codes[i]);
    decode.set(codes[i], e);
  });
  return { encode, decode };
})();

function greatCipherEncode(bytes: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < bytes.length; ) {
    const pair = i + 1 < bytes.length ? NOMENCLATOR.encode.get(256 + bytes[i] * 256 + bytes[i + 1]) : undefined;
    const code = pair ?? NOMENCLATOR.encode.get(bytes[i])!;
    i += pair !== undefined ? 2 : 1;
    const s = String(code).padStart(3, '0');
    out.push(s.charCodeAt(0), s.charCodeAt(1), s.charCodeAt(2));
  }
  return Uint8Array.from(out);
}

function greatCipherDecode(digits: Uint8Array): Uint8Array {
  if (digits.length % 3 !== 0) throw new Error('Format Apex : grand chiffre tronqué.');
  const out: number[] = [];
  for (let i = 0; i < digits.length; i += 3) {
    const code = (digits[i] - 48) * 100 + (digits[i + 1] - 48) * 10 + (digits[i + 2] - 48);
    const entry = NOMENCLATOR.decode.get(code);
    if (!entry) throw new Error('Format Apex : code du grand chiffre inconnu.');
    out.push(...entry);
  }
  return Uint8Array.from(out);
}

// --- compression (deflate brut) --------------------------------------------------------------------

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const response = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await response.arrayBuffer());
}
const deflate = (b: Uint8Array) => pipe(b, new CompressionStream('deflate-raw'));
const inflate = (b: Uint8Array) => pipe(b, new DecompressionStream('deflate-raw'));

// --- 2 et 6. AES-256-GCM ---------------------------------------------------------------------------

async function aesKey(raw: Uint8Array) {
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function aesEncrypt(raw: Uint8Array, plain: Uint8Array, nonce: Uint8Array): Promise<Uint8Array> {
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, await aesKey(raw), plain));
  const out = new Uint8Array(nonce.length + ct.length);
  out.set(nonce);
  out.set(ct, nonce.length);
  return out;
}

async function aesDecrypt(raw: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const nonce = data.subarray(0, NONCE_BYTES);
  const ct = data.subarray(NONCE_BYTES);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, await aesKey(raw), ct));
}

// --- 3. Vigenère (octets → lettres A–P, puis décalage par la clé sur A–Z) ------------------------

const A = 65;

function bytesToLetters(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(A + (b >> 4), A + (b & 15));
  return s;
}

function lettersToBytes(s: string): Uint8Array {
  if (s.length % 2 !== 0) throw new Error('Format Apex : lettres impaires.');
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) {
    const hi = s.charCodeAt(2 * i) - A, lo = s.charCodeAt(2 * i + 1) - A;
    if (hi < 0 || hi > 15 || lo < 0 || lo > 15) throw new Error('Format Apex : lettre hors de A–P.');
    out[i] = (hi << 4) | lo;
  }
  return out;
}

function vigenere(s: string, direction: 1 | -1): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const k = VIGENERE_KEY.charCodeAt(i % VIGENERE_KEY.length) - A;
    out += String.fromCharCode(A + ((((s.charCodeAt(i) - A + direction * k) % 26) + 26) % 26));
  }
  return out;
}

// --- 4. grille de Fleissner 8 × 8 ------------------------------------------------------------------

const GRID = 8;
const BLOCK = GRID * GRID;
const rotate = (p: number) => {
  const r = Math.floor(p / GRID), c = p % GRID;
  return c * GRID + (GRID - 1 - r); // quart de tour horaire
};
/** Trous de la grille : un par orbite de 4 cases (choix de rotation fixe par case du quart). */
const HOLES: number[][] = (() => {
  const random = mulberry32(1626); // graine fixe du format v1
  const base: number[] = [];
  for (let r = 0; r < GRID / 2; r++) {
    for (let c = 0; c < GRID / 2; c++) {
      let p = r * GRID + c;
      const turns = Math.floor(random() * 4);
      for (let t = 0; t < turns; t++) p = rotate(p);
      base.push(p);
    }
  }
  // Les quatre positions de la grille : chacune lit ses trous dans l'ordre de lecture.
  const all: number[][] = [];
  let holes = base;
  for (let t = 0; t < 4; t++) {
    all.push([...holes].sort((a, b) => a - b));
    holes = holes.map(rotate);
  }
  return all;
})();

function fleissnerEncode(s: string): string {
  let out = '';
  for (let b = 0; b < s.length; b += BLOCK) {
    const block = s.slice(b, b + BLOCK);
    const grid = new Array<string>(BLOCK);
    let i = 0;
    for (const holes of HOLES) for (const h of holes) grid[h] = block[i++];
    out += grid.join('');
  }
  return out;
}

function fleissnerDecode(s: string): string {
  let out = '';
  for (let b = 0; b < s.length; b += BLOCK) {
    const grid = s.slice(b, b + BLOCK);
    for (const holes of HOLES) for (const h of holes) out += grid[h];
  }
  return out;
}

// --- 5. Enigma I -----------------------------------------------------------------------------------

const ROTORS = [
  { wiring: 'EKMFLGDQVZNTOWYHXUSPAIBRCJ', notch: 'Q' }, // I (gauche)
  { wiring: 'AJDKSIRUXBLHWTMCQGZNPYFVOE', notch: 'E' }, // II (milieu)
  { wiring: 'BDFHJLCPRTXVZNYEIWGAKMUSQO', notch: 'V' }, // III (droite, rapide)
];
// Réflecteur B (UKW-B) donné par ses 13 paires : une involution par construction.
const REFLECTOR_B_PAIRS = 'AY BR CU DH EQ FS GL IP JX KN MO TZ VW';
const START = 'APX';
const PLUGBOARD = 'AE BF CM DQ HU JN LX PR SZ VW';

/** Involution sur A–Z à partir de paires « AB CD … » (lettres absentes : fixes). */
function pairsToTable(pairs: string): number[] {
  const table = Array.from({ length: 26 }, (_, i) => i);
  for (const pair of pairs.split(' ')) {
    const a = pair.charCodeAt(0) - A, b = pair.charCodeAt(1) - A;
    table[a] = b;
    table[b] = a;
  }
  return table;
}

const enigmaTables = (() => {
  for (const r of ROTORS) {
    if (new Set(r.wiring).size !== 26 || r.wiring.length !== 26) throw new Error('Format Apex : rotor Enigma invalide.');
  }
  const forward = ROTORS.map((r) => Array.from(r.wiring, (ch) => ch.charCodeAt(0) - A));
  const backward = forward.map((w) => {
    const inv = new Array<number>(26);
    w.forEach((v, i) => { inv[v] = i; });
    return inv;
  });
  const plug = pairsToTable(PLUGBOARD);
  const reflector = pairsToTable(REFLECTOR_B_PAIRS);
  const notches = ROTORS.map((r) => r.notch.charCodeAt(0) - A);
  return { forward, backward, plug, reflector, notches };
})();

/** Enigma est réciproque : la même fonction chiffre et déchiffre (anneaux à A). */
function enigma(s: string): string {
  const { forward, backward, plug, reflector, notches } = enigmaTables;
  const pos = Array.from(START, (ch) => ch.charCodeAt(0) - A);
  const through = (wiring: number[], c: number, p: number) => (wiring[(c + p) % 26] - p + 26) % 26;
  let out = '';
  for (let i = 0; i < s.length; i++) {
    // Pas des rotors, double pas du rotor du milieu compris.
    if (pos[1] === notches[1]) {
      pos[1] = (pos[1] + 1) % 26;
      pos[0] = (pos[0] + 1) % 26;
    } else if (pos[2] === notches[2]) {
      pos[1] = (pos[1] + 1) % 26;
    }
    pos[2] = (pos[2] + 1) % 26;
    let c = plug[s.charCodeAt(i) - A];
    for (let r = 2; r >= 0; r--) c = through(forward[r], c, pos[r]);
    c = reflector[c];
    for (let r = 0; r <= 2; r++) c = through(backward[r], c, pos[r]);
    out += String.fromCharCode(A + plug[c]);
  }
  return out;
}

// --- assemblage ------------------------------------------------------------------------------------

const LENGTH_LETTERS = 8;

function lengthToLetters(n: number) {
  let s = '';
  for (let i = 0; i < LENGTH_LETTERS; i++) {
    s = String.fromCharCode(A + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

function lettersToLength(s: string) {
  let n = 0;
  for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - A);
  return n;
}

function toBase64(bytes: Uint8Array) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(s: string) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const randomNonce = () => crypto.getRandomValues(new Uint8Array(NONCE_BYTES));

/** Étapes intermédiaires (vecteurs de test pour la réimplémentation côté moteur). */
export interface ApexCipherTrace {
  greatCipher: string;
  afterAes1Hex: string;
  vigenere: string;
  fleissner: string;
  enigma: string;
  output: string;
}

/** Chiffre un texte au format Apex. `nonces` : uniquement pour produire des vecteurs de test. */
export async function apexEncrypt(
  plain: string,
  nonces?: { nonce1: Uint8Array; nonce2: Uint8Array },
  trace?: Partial<ApexCipherTrace>,
): Promise<string> {
  const digits = greatCipherEncode(new TextEncoder().encode(plain));
  const stage2 = await aesEncrypt(AES_KEY_1, await deflate(digits), nonces?.nonce1 ?? randomNonce());
  const stage3 = vigenere(bytesToLetters(stage2), 1);
  const padded = stage3 + 'X'.repeat((BLOCK - (stage3.length % BLOCK)) % BLOCK);
  const stage4 = lengthToLetters(stage3.length) + fleissnerEncode(padded);
  const stage5 = enigma(stage4);
  const stage6 = await aesEncrypt(AES_KEY_2, new TextEncoder().encode(stage5), nonces?.nonce2 ?? randomNonce());
  const out = new Uint8Array(MAGIC.length + stage6.length);
  out.set(MAGIC);
  out.set(stage6, MAGIC.length);
  const output = toBase64(out);
  if (trace) {
    Object.assign(trace, {
      greatCipher: new TextDecoder().decode(digits),
      afterAes1Hex: Array.from(stage2, (b) => b.toString(16).padStart(2, '0')).join(''),
      vigenere: stage3,
      fleissner: stage4,
      enigma: stage5,
      output,
    });
  }
  return output;
}

/** Déchiffre un texte au format Apex ; lève une erreur si le contenu n'est pas valide. */
export async function apexDecrypt(encoded: string): Promise<string> {
  const data = fromBase64(encoded.trim());
  if (data.length < MAGIC.length || !MAGIC.every((b, i) => data[i] === b)) throw new Error('Format Apex : signature absente.');
  const stage5 = new TextDecoder().decode(await aesDecrypt(AES_KEY_2, data.subarray(MAGIC.length)));
  const stage4 = enigma(stage5);
  const length = lettersToLength(stage4.slice(0, LENGTH_LETTERS));
  const stage3 = fleissnerDecode(stage4.slice(LENGTH_LETTERS)).slice(0, length);
  const stage2 = lettersToBytes(vigenere(stage3, -1));
  const digits = await inflate(await aesDecrypt(AES_KEY_1, stage2));
  return new TextDecoder().decode(greatCipherDecode(digits));
}
