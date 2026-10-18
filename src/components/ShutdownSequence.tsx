import React, { useEffect, useState } from 'react';
import { isFlatUi } from '@/utils/interfaceMode';
import { runShutdownSequence } from '@/utils/shutdownSequence';

/**
 * Déclencheur de la fermeture (cf. utils/shutdownSequence.ts) : écoute la demande du processus principal
 * (`apexDesktop.onCloseRequested`) ou l'événement `apex-close-requested` (tests). Interface LiquidGlass : le rideau de
 * transition (SpaceTransitionOverlay) affiche les messages. Interface classique : écran noir à plat, sans animation.
 */
export const ShutdownSequence: React.FC = () => {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    const start = () => { void runShutdownSequence(isFlatUi(), setText); };
    const off = window.apexDesktop?.onCloseRequested?.(start);
    window.addEventListener('apex-close-requested', start);
    return () => {
      off?.();
      window.removeEventListener('apex-close-requested', start);
    };
  }, []);

  if (!isFlatUi() || text === null) return null;
  return (
    <div
      role="status"
      style={{
        position: 'fixed', inset: 0, zIndex: 2147483000, background: '#000', color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center',
        padding: 32, fontFamily: 'system-ui, sans-serif', fontSize: 18, lineHeight: 1.5,
      }}
    >
      {text}
    </div>
  );
};
