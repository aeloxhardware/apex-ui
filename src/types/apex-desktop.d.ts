// Pont exposé par electron/preload.cjs dans l'application de bureau ; absent dans un navigateur
// (serveur de développement Vite seul).
export {};

declare global {
  interface ApexConvertRequest {
    text: string;
    mode: 'polar' | 'dynamic';
    /** Centre du plateau d'origine, en coordonnées du fichier source (mm). */
    centerX: number;
    centerY: number;
    /** Logiciel d'origine, repris dans l'en-tête du fichier converti. */
    source: string;
    /** Supprime les mouvements dont la buse finit au-delà de ce rayon (mm) ; 0 ou absent : aucun. */
    dropOutsideRadius?: number;
  }

  interface ApexConvertSummary {
    movesIn: number;
    droppedMoves: number;
    linesOut: number;
    maxErrorMm: number;
    bMin: number;
    bMax: number;
  }

  interface ApexProfileFolder {
    name: string;
    /** Chemin relatif à `profiles/`, séparateur `/`. */
    path: string;
    folders: ApexProfileFolder[];
    printers: { name: string; path: string }[];
  }

  interface ApexProfile {
    status: 'ok' | 'empty' | 'invalid';
    data: unknown;
    error: string | null;
    /** Data URL de la photo, null si absente ou vide. */
    image: string | null;
  }

  interface ApexDesktopBridge {
    convertGCode(request: ApexConvertRequest): Promise<{ text: string; summary: ApexConvertSummary | null }>;
    /** Abonnement à la progression (0–100) ; renvoie la fonction de désabonnement. */
    onConvertProgress(callback: (percent: number) => void): () => void;
    saveGCode(request: { name: string; text: string }): Promise<{ saved: boolean; path?: string }>;
    /** Écrit (atomiquement) un G-code à un chemin connu : modification en place. */
    writeGCode(request: { path: string; text: string }): Promise<{ saved: boolean; path: string }>;
    /** Chemin réel d'un fichier déposé ou choisi, null s'il n'en a pas. */
    pathForFile?(file: File): string | null;
    /** Arbre du dossier `profiles/` (cf. electron/profiles.cjs). */
    scanProfiles?(): Promise<ApexProfileFolder>;
    /** Contenu d'un profil d'imprimante (chemin relatif d'un .json) et sa photo. */
    readProfile?(path: string): Promise<ApexProfile>;
    /** Demande un canal vers le noyau C++ d'édition : le MessagePort arrive ensuite par
     * window.postMessage({ type: 'apex-edit-port' }) — cf. src/utils/editKernelClient.ts. */
    openEditChannel(): void;
    /** Zoom natif de la fenêtre (échelle de l'interface, cf. utils/uiScalePrefs.ts). */
    setZoomFactor?(factor: number): void;
  }

  interface Window {
    apexDesktop?: ApexDesktopBridge;
  }
}
