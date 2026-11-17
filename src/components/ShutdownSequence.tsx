import React, { useEffect, useRef, useState } from 'react';
import { isFlatUi } from '@/utils/interfaceMode';
import { runShutdownSequence } from '@/utils/shutdownSequence';
import { isProjectDirty, saveProject } from '@/utils/projectSave';
import { ImportantBox, ImportantBoxSpinner, ImportantBoxText } from './ImportantBox';

/** Durée minimale d'affichage de la boîte d'enregistrement : assez pour être lue, même si l'écriture est instantanée. */
const SAVE_MIN_MS = 1200;

/** Projet modifié : enregistré (3MF, répertoire dédié) avant que la fermeture ne commence ; une panne ne retient jamais l'application. */
async function saveBeforeClose(setSaving: (saving: boolean) => void) {
  if (!isProjectDirty() || !window.apexDesktop?.saveProject) return;
  setSaving(true);
  const minimum = new Promise<void>((resolve) => window.setTimeout(resolve, SAVE_MIN_MS));
  await saveProject().catch((error) => console.warn('[apex] enregistrement avant fermeture :', error));
  await minimum;
  setSaving(false);
}

/**
 * Déclencheur de la fermeture (cf. utils/shutdownSequence.ts) : écoute la demande du processus principal
 * (`apexDesktop.onCloseRequested`) ou l'événement `apex-close-requested` (tests). Interface LiquidGlass : le rideau de
 * transition (SpaceTransitionOverlay) affiche les messages. Interface classique : écran noir à plat, sans animation.
 */
export const ShutdownSequence: React.FC = () => {
  const [text, setText] = useState<string | null>(null);
  const [active, setActive] = useState(false);
  const [saving, setSaving] = useState(false);
  const closingRef = useRef(false);

  useEffect(() => {
    const start = () => {
      if (closingRef.current) return;
      closingRef.current = true;
      void saveBeforeClose(setSaving).then(() => runShutdownSequence(isFlatUi(), setText));
    };
    const off = window.apexDesktop?.onCloseRequested?.(start);
    const onStarted = () => setActive(true);
    window.addEventListener('apex-close-requested', start);
    window.addEventListener('apex-shutdown-started', onStarted);
    return () => {
      off?.();
      window.removeEventListener('apex-close-requested', start);
      window.removeEventListener('apex-shutdown-started', onStarted);
    };
  }, []);

  const flat = isFlatUi();
  return (
    <>
      {saving && (
        <ImportantBox icon={<ImportantBoxSpinner />} title="Enregistrement en cours des projets...">
          <ImportantBoxText>L'enregistrement d'un projet enregistre tout en 3MF dans un répertoire dédié.</ImportantBoxText>
        </ImportantBox>
      )}
      {flat && text !== null && (
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
      )}
      {active && (
        <button
          type="button"
          data-apex-force-close
          data-apex-tooltip="Forcer la fermeture : quitte immédiatement, sans terminer le nettoyage."
          onClick={() => window.apexDesktop?.shutdownForce?.()}
          style={{
            position: 'fixed', right: 24, bottom: 24, zIndex: 2147483001, padding: '8px 16px',
            font: '14px system-ui, sans-serif', cursor: 'pointer', color: '#fff',
            background: flat ? '#000' : 'rgba(255,255,255,0.12)', border: '1px solid #fff',
            borderRadius: flat ? 0 : 10, backdropFilter: flat ? undefined : 'blur(8px)',
          }}
        >
          Forcer la fermeture
        </button>
      )}
    </>
  );
};
