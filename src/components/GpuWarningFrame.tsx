import React, { createContext, useContext, useState } from 'react';
import { isFlatUi } from '@/utils/interfaceMode';

/**
 * Bandeau orange en bas de l'application quand le GPU est moins puissant qu'une RTX 3080 (variable low_gpu_pwr, cf.
 * electron/gpu-tier.cjs, relayée par le preload en `apexDesktop.lowGpuPower`). Le bandeau occupe sa propre ligne : il
 * ne se superpose pas à l'interface, qui est enfermée dans la zone restante au-dessus (`contain: layout` en fait le
 * repère de tout ce qui est en position fixe ou absolue ; les hauteurs « plein écran » y valent 100 % de la zone).
 * Sans le drapeau (GPU suffisant, navigateur), les enfants sont rendus tels quels.
 */
const MESSAGE_LIQUID =
  "Votre processeur de calcul graphique est susceptible de ne pas répondre aux exigences minimales d'Apex. Vous devriez basculer l'interface en mode Classique.";
const MESSAGE_CLASSIC =
  "Votre processeur de calcul graphique est susceptible de ne pas répondre aux exigences minimales d'Apex. Le traitement logiciel est susceptible de prendre plus de temps, de conduire à des absences de réponse du logiciel, voire de ne jamais aboutir.";

const PortalRootContext = createContext<HTMLElement | null>(null);

/**
 * Élément où attacher les calques « hors flux » (verre des panneaux, infobulles, modales, barres de défilement) :
 * la zone de l'interface quand le bandeau est affiché, sinon `document.body`. Ils doivent y rester : la zone est un
 * contexte d'empilement, donc un calque attaché au body (z-index 999) passerait AU-DESSUS de tout son contenu.
 */
export const usePortalRoot = (): HTMLElement => useContext(PortalRootContext) ?? document.body;

export const GpuWarningFrame: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [zone, setZone] = useState<HTMLElement | null>(null);
  if (!window.apexDesktop?.lowGpuPower) return <>{children}</>;
  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column' }}>
      <div ref={setZone} className="apex-gpu-frame" style={{ flex: '1 1 0', minHeight: 0, position: 'relative', overflow: 'hidden', contain: 'layout' }}>
        <PortalRootContext.Provider value={zone}>{children}</PortalRootContext.Provider>
      </div>
      <div
        role="alert"
        style={{
          flex: '0 0 auto',
          padding: '8px 16px',
          background: '#f59e0b',
          color: '#1f1300',
          fontSize: 13,
          fontWeight: 600,
          lineHeight: 1.35,
          textAlign: 'center',
        }}
      >
        {isFlatUi() ? MESSAGE_CLASSIC : MESSAGE_LIQUID}
      </div>
    </div>
  );
};
