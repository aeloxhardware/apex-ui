/**
 * Conversion polaire d'un G-code par le script Python : via l'application de bureau (pont Electron
 * `window.apexDesktop`) ou, en développement dans un navigateur, via le serveur Vite
 * (`/__apex/convert-gcode`, cf. vite.config.ts). Indisponible dans une version web de production.
 */

type ConvertResult = { text: string; summary: ApexConvertSummary | null };

export const isConversionAvailable = () =>
  typeof window !== 'undefined' && (!!window.apexDesktop || import.meta.env.DEV);

export async function runConversion(
  request: ApexConvertRequest,
  onProgress: (percent: number) => void,
): Promise<ConvertResult> {
  const desktop = window.apexDesktop;
  if (desktop) {
    const unsubscribe = desktop.onConvertProgress(onProgress);
    try {
      return await desktop.convertGCode(request);
    } finally {
      unsubscribe();
    }
  }
  if (!import.meta.env.DEV) {
    throw new Error("la conversion polaire n'est disponible que dans l'application Apex.");
  }

  const response = await fetch('/__apex/convert-gcode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok || !response.body) {
    throw new Error(`serveur de conversion indisponible (${response.status}).`);
  }
  // Flux : lignes « PROGRESS n », puis « RESULT » ou « ERROR » suivi du reste de la réponse.
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let outcome: 'RESULT' | 'ERROR' | null = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    while (!outcome) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) break;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      const progress = /^PROGRESS (\d+)$/.exec(line);
      if (progress) onProgress(Number(progress[1]));
      else if (line === 'RESULT' || line === 'ERROR') outcome = line;
    }
    if (done) break;
  }
  buffer += decoder.decode();
  if (outcome === 'RESULT') return JSON.parse(buffer) as ConvertResult;
  throw new Error(outcome === 'ERROR' ? buffer : 'réponse du serveur de conversion incomplète.');
}
