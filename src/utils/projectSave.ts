/**
 * Projet en cours : suivi des modifications et enregistrement. Un projet s'enregistre en un seul fichier 3MF (modèles
 * du plateau + G-code) dans le répertoire dédié d'Apex (Documents/Apex/Projets, cf. electron/main.cjs). L'application
 * s'en sert avant de se fermer (components/ShutdownSequence.tsx) et pour le bouton « Enregistrer le projet ».
 */
import { emitApex } from '@/events/apexEvents';
import { stashPeekBytes } from '@/utils/spaceStash';
import { buildThreeMf } from '@/utils/threeMf';

/** Clé de la réserve où le viewport dépose le projet en 3MF quand il est démonté (cf. viewportModelStash.ts). */
export const PROJECT_3MF_KEY = 'plate-3mf';

let dirty = false;

/** Un modèle, un G-code produit ou une modification d'édition : le projet n'est plus celui qui est enregistré. */
export function markProjectDirty() {
  dirty = true;
}
export const isProjectDirty = () => dirty;

type GCodeProvider = () => Promise<{ name: string; text: string } | null>;
let gcodeProvider: GCodeProvider | null = null;

/** Le G-code ouvert, tel qu'il serait exporté (modifications comprises) ; un seul fournisseur à la fois. */
export function setProjectGCodeProvider(provider: GCodeProvider | null) {
  gcodeProvider = provider;
}

/** Plateau en 3MF : par le viewport s'il est monté, sinon par la copie déposée à son démontage. */
async function plateBytes(): Promise<Uint8Array | null> {
  let live: Promise<Uint8Array | null> | undefined;
  emitApex('apex-export-plate-3mf', {
    resolve: (bytes) => {
      live = bytes;
    },
  });
  return live ?? stashPeekBytes(PROJECT_3MF_KEY);
}

export interface SavedProject {
  path: string;
}

/**
 * Enregistre le projet. Renvoie null s'il n'y a rien à enregistrer ou hors application de bureau (pas de
 * répertoire dédié) ; l'état « modifié » n'est levé qu'après une écriture réussie.
 */
export async function saveProject(): Promise<SavedProject | null> {
  const desktop = window.apexDesktop;
  if (!desktop?.saveProject) return null;
  const bytes = await projectBytes();
  if (!bytes) return null;
  const saved = await desktop.saveProject(bytes);
  dirty = false;
  return saved;
}

/** Octets du .3mf à écrire et nom de base du fichier ; null s'il n'y a ni modèle ni G-code. */
async function projectBytes(): Promise<{ name: string; bytes: Uint8Array } | null> {
  const plate = await plateBytes();
  const gcode = (await gcodeProvider?.().catch(() => null)) ?? null;
  if (!plate && !gcode) return null;
  // Le plateau arrive déjà en 3MF : on y ajoute le G-code plutôt que de le reconstruire.
  const bytes = plate ? await addGCode(plate, gcode) : await buildThreeMf({ parts: [], gcode });
  return { name: gcode?.name.replace(/\.[^.]+$/, '') ?? 'Projet', bytes };
}

async function addGCode(threeMf: Uint8Array, gcode: { name: string; text: string } | null): Promise<Uint8Array> {
  if (!gcode) return threeMf;
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(threeMf);
  zip.file('Metadata/plate_1.gcode', gcode.text);
  zip.file('Metadata/plate_1.gcode.name', gcode.name);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
