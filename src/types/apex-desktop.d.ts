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

  interface ApexDesktopBridge {
    convertGCode(request: ApexConvertRequest): Promise<{ text: string; summary: ApexConvertSummary | null }>;
    /** Abonnement à la progression (0–100) ; renvoie la fonction de désabonnement. */
    onConvertProgress(callback: (percent: number) => void): () => void;
    saveGCode(request: { name: string; text: string }): Promise<{ saved: boolean; path?: string }>;
    /** Demande un canal vers le noyau C++ d'édition : le MessagePort arrive ensuite par
     * window.postMessage({ type: 'apex-edit-port' }) — cf. src/utils/editKernelClient.ts. */
    openEditChannel(): void;
  }

  interface Window {
    apexDesktop?: ApexDesktopBridge;
  }
}
