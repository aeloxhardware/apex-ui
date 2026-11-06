import type { LineTypeId } from './gcodeLineTypes';
import type { ApexHeaderPayload, ApexJournal } from '@/utils/apexHeader';
import type { ConversionMode } from './gcodeParseConstants';
import type { Kinematics } from '@/utils/kinematics';
import type { GCodeGenerator } from './gcodeGenerator';

export type GCodeKind = 'polar' | 'cartesian';

export interface GCodeMove {
  /** Mot X : rayon R (polaire) ou X recentré sur le plateau (cartésien), en mm. */
  x: number;
  /** Mot Y : angle C du plateau en degrés (polaire) ou Y recentré sur le plateau en mm (cartésien). */
  y: number;
  z: number;
  /** Inclinaison de la tête (degrés) ; 0 en cartésien sauf fichier à orientation d'outil, où c'est
   * l'écart à la verticale (B + 90 : B = −90 ↔ outil vertical, cf. `toolAxisAt`). */
  b: number;
  /** Azimut de l'inclinaison de l'outil (mot C, degrés) — cartésien à orientation d'outil seulement,
   * 0 sinon. */
  c: number;
  extruding: boolean;
  type: LineTypeId;
}

export interface LineTypeStat {
  /** Temps machine (s). */
  time: number;
  /** Filament déposé (mm de filament, hors réinjection après rétraction). */
  filamentMm: number;
  massG: number;
}

type MarkerTypeId = Extract<LineTypeId, 'retraction' | 'unretraction' | 'seam'>;

/**
 * Critères de coloration continus du calque (cf. gcodeColormap.ts) — tous dérivés de données par
 * mouvement, normalisés sur le min/max du fichier (`ParsedGCode.ranges`). Le type de ligne reste
 * hors de cette liste : coloration catégorielle, jamais un dégradé.
 */
export type ContinuousColorByMode =
  | 'speed' | 'accel' | 'headAngle' | 'segmentLength' | 'elapsedTime'
  | 'extrusionRatio' | 'volumetricFlow' | 'layerSpeedRatio' | 'lineWidth'
  | 'layerHeight' | 'temperature' | 'fanSpeed';

export type ColorByMode = 'lineType' | ContinuousColorByMode;

export interface ColorByRange {
  min: number;
  max: number;
  avg: number;
}

export type ColorByRanges = Record<ContinuousColorByMode, ColorByRange>;

/** Plage de mouvements insérés par l'édition (re-tranchage), indices courants. */
export interface InsertedRange {
  at: number;
  count: number;
}

export interface ParsedGCode {
  kind: GCodeKind;
  moves: GCodeMove[];
  /** Temps machine cumulé (s) à l'arrivée de chaque mouvement (`times[0] = 0`), déduit de la
   * distance parcourue par la buse et de l'avance F — cf. `timeAtIndex`/`indexAtTime`. */
  times: Float64Array;
  minZ: number;
  maxZ: number;
  maxR: number;
  minC: number;
  maxC: number;
  extrudingCount: number;
  lineStats: Record<LineTypeId, LineTypeStat>;
  /** Marqueurs ponctuels, par index croissant du mouvement à la FIN duquel ils se trouvent. */
  markers: Record<MarkerTypeId, Uint32Array>;
  /** Logiciel qui a le plus probablement produit le fichier, null si rien ne permet de le dire. */
  generator: GCodeGenerator | null;
  /** Imprimante cible déclarée dans l'en-tête, si présente. */
  printer: string | null;
  /** Cartésien : dépôts à Z variable au sein d'une couche (tranchage courbe, vase…) — l'angle
   * dynamique de la conversion polaire y est utile. */
  nonPlanar: boolean;
  /** Cartésien : le fichier pilote l'orientation de l'outil (mots B/C, `; TOOL_AXIS:`) — `moves[k].b`/`c`
   * donnent alors l'inclinaison et l'azimut de la tête. */
  toolOriented: boolean;
  /** Cartésien : centre du plateau d'origine (coordonnées du fichier), soustrait des X/Y. */
  bedCenter: { x: number; y: number };
  /** Fichier issu de la conversion polaire d'Apex (`; apex_conversion_mode = …`), sinon null. */
  conversion: ConversionMode | null;
  /** Cartésien : dépôts qui finissent hors du plateau de l'Apex (PLATE_RADIUS_MM autour du centre)
   * — indices croissants — et nombre de traits (suites continues) qu'ils forment. */
  offPlate: { moves: Uint32Array; traits: number };
  /** Cartésien, PrusaSlicer à couches non planaires : contours imprimés dans l'air (type `airContour`),
   * en paires [premier, dernier] d'indices de mouvement croissants. Vide ailleurs. */
  airContours: Uint32Array;

  // --- Données par mouvement pour la coloration « colorer par » (cf. gcodeColormap.ts) ---
  // Tableaux parallèles à `moves`/`times` (index 0 inutilisé, comme `times[0] = 0`), remplis une
  // fois par appel à `push()` — donc automatiquement corrects après subdivision d'arc (G2/G3).
  /** Vitesse réellement atteinte (mm/s) : vitesse de croisière après limitation par accélération et
   * jerk en cartésien, distance/dt en polaire (pas de planificateur trapézoïdal séparé). */
  speedMmS: Float32Array;
  /** Accélération modale au mouvement (mm/s²) — celle appliquée par le firmware à ce moment. */
  accelMmS2: Float32Array;
  nozzleTempC: Float32Array;
  bedTempC: Float32Array;
  fanPct: Float32Array;
  /** Épaisseur locale de couche (mm), NaN si indéterminable (premier passage à cet endroit). */
  layerHeightMm: Float32Array;
  /** Largeur de cordon (mm) : commentaire `;WIDTH:` du générateur si présent, sinon estimée depuis
   * le débit et `layerHeightMm`. NaN si ni l'un ni l'autre n'est disponible. */
  widthMm: Float32Array;
  /** Longueur du segment (mm) : corde cartésienne ou longueur d'arc de la pointe de buse en polaire. */
  segLengthMm: Float32Array;
  /** Filament déposé (mm), hors réinjection après rétraction — même valeur que `lineStats[...].filamentMm`
   * accumule, mais par mouvement : sert au débit volumétrique et à la pression d'extrusion relative
   * (cf. gcodeColormap.ts), qui la convertissent en volume via `filamentDiameterMm`. */
  depositMm: Float32Array;
  /** Diamètre de filament utilisé pour convertir `depositMm` en volume (mm, cf. en-tête du fichier
   * ou valeur par défaut) — évite de dupliquer cette constante dans gcodeColormap.ts. */
  filamentDiameterMm: number;
  /** Index de couche (cartésien uniquement, détection par palier Z) ; 0 partout en polaire. */
  layerIndex: Uint32Array;
  /** Vitesse max de la couche courante (mm/s), un par mouvement (valeur répétée dans la couche) —
   * pour `layerSpeedRatio` = speedMmS / layerMaxSpeedMmS. */
  layerMaxSpeedMmS: Float32Array;
  /** Min/max/moyenne par fichier de chaque critère continu, pour normaliser le dégradé (§ légende). */
  ranges: ColorByRanges;

  // --- Correspondance avec le texte du fichier (édition : recalcul et réécriture de E) ---
  /** Ligne du fichier (index à partir de 0) qui produit le mouvement ; un arc G2/G3 découpé partage
   * la ligne de l'arc entre plusieurs mouvements. */
  lineIndex: Uint32Array;
  /** Delta d'extrudeur du mouvement (mm), rétractions comprises (négatif). */
  eDelta: Float64Array;
  /** Position absolue de l'extrudeur (mm) avant le mouvement, en mode absolu (M82) ; NaN en relatif. */
  eAbsBefore: Float64Array;
  /** Le mot E est présent sur la ligne du mouvement. */
  hasEWord: Uint8Array;
  /** Mode d'extrusion relatif (M83 ou G91) au mouvement. */
  eRelative: Uint8Array;
  /** Le fichier passe en pouces (G20) à un moment : la réécriture n'est pas prise en charge. */
  usesInches: boolean;
  /** Mouvements modifiés par l'onglet Édition depuis le chargement (positions dans `moves`,
   * extrusion dans `eDelta`) : les lignes à réécrire à l'enregistrement. */
  editedMoves?: Set<number> | undefined;
  /** Plages de mouvements insérées par l'édition (couches interpolées), par indice croissant : sans ligne dans
   * le texte d'origine (`lineIndex` = INSERTED_LINE), elles sont écrites par gcodeWriter.ts. */
  insertedBlocks?: InsertedRange[];
  /** Mouvements dont le dépôt a été rogné par l'édition (rognage) : ils ne déposent plus. */
  trimmedMoves?: Set<number> | undefined;
  /** Cinématique pivot/pointe du fichier : celle de la ligne `; apex_kinematics` (R-007), sinon `LEGACY_KINEMATICS`. */
  kinematics: Kinematics;
  /** Vrai si le fichier déclare sa cinématique (sinon `kinematics` est la valeur supposée des anciens fichiers). */
  kinematicsDeclared: boolean;
  /** Bloc d'en-tête chiffré Apex lu au chargement (utils/apexHeader.ts), null s'il n'y en a pas. */
  apexHeader?: ApexHeaderPayload | null;
  /** Journal des modifications courant (piles d'annulation et de rétablissement du noyau),
   * écrit dans l'en-tête chiffré à l'enregistrement si le réglage est activé. */
  editJournal?: ApexJournal;
}
