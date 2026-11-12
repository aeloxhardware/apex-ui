import React, { createContext, useContext, useState } from 'react';
import { X } from 'lucide-react';
import { TitleBar } from '@/components/TitleBar';
import { isFlatUi } from '@/utils/interfaceMode';

/**
 * Bandeau orange en bas de l'application quand le GPU est moins puissant qu'une RTX 3080 (variable low_gpu_pwr, cf.
 * electron/gpu-tier.cjs, relayée par le preload en `apexDesktop.lowGpuPower`). Le bandeau occupe sa propre ligne : il
 * ne se superpose pas à l'interface, qui est enfermée dans la zone restante au-dessus (`contain: layout` en fait le
 * repère de tout ce qui est en position fixe ou absolue ; les hauteurs « plein écran » y valent 100 % de la zone).
 * Même cadre pour le bandeau Apex ancré de l'application de bureau (TitleBar.tsx), au-dessus de la zone.
 * Ni l'un ni l'autre (navigateur, GPU suffisant sans fenêtre sans cadre) : les enfants sont rendus tels quels.
 */
const MESSAGE_LIQUID =
  "Votre processeur de calcul graphique est susceptible de ne pas répondre aux exigences minimales d'Apex. Vous devriez basculer l'interface en mode Classique.";
const MESSAGE_CLASSIC =
  "Votre processeur de calcul graphique est susceptible de ne pas répondre aux exigences minimales d'Apex. Le traitement logiciel est susceptible de prendre plus de temps, de conduire à des absences de réponse du logiciel, voire de ne jamais aboutir.";

const MESSAGE_TOOLTIP =
  "Mais que veux-tu que je te dise de plus, mon gars? T'as un GPU éclaté, je ne peux pas l'inventer ! Et à moins que tu sois Elon Musk, bonne chance pour trouver un GPU en ce moment";

const PortalRootContext = createContext<HTMLElement | null>(null);

/**
 * Élément où attacher les calques « hors flux » (verre des panneaux, infobulles, modales, barres de défilement) :
 * la zone de l'interface quand le bandeau est affiché, sinon `document.body`. Ils doivent y rester : la zone est un
 * contexte d'empilement, donc un calque attaché au body (z-index 999) passerait AU-DESSUS de tout son contenu.
 */
export const usePortalRoot = (): HTMLElement => useContext(PortalRootContext) ?? document.body;

const BANNER_STYLE: React.CSSProperties = {
  flex: '0 0 auto',
  position: 'relative',
  padding: '8px 40px',
  background: '#ff4000',
  color: '#1f1300',
  fontSize: 13,
  fontWeight: 600,
  lineHeight: 1.35,
  textAlign: 'center',
};

const CLOSE_STYLE: React.CSSProperties = {
  position: 'absolute',
  top: '50%',
  right: 10,
  transform: 'translateY(-50%)',
  display: 'flex',
  padding: 4,
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
};

/** Le bandeau d'avertissement, avec sa croix : masqué jusqu'au prochain lancement (l'état n'est pas conservé). */
const GpuWarningBanner: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <div role="alert" data-apex-tooltip={MESSAGE_TOOLTIP} style={BANNER_STYLE}>
    {isFlatUi() ? MESSAGE_CLASSIC : MESSAGE_LIQUID}
    <button type="button" aria-label="Fermer le bandeau" data-apex-tooltip="Fermer le bandeau" onClick={onClose} style={CLOSE_STYLE}>
      <X size={16} />
    </button>
  </div>
);

export const GpuWarningFrame: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [zone, setZone] = useState<HTMLElement | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const customTitleBar = Boolean(window.apexDesktop?.customTitleBar);
  const lowGpu = Boolean(window.apexDesktop?.lowGpuPower);
  if (!lowGpu && !customTitleBar) return <>{children}</>;
  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column' }}>
      {customTitleBar && <TitleBar />}
      <div ref={setZone} className="apex-gpu-frame" style={{ flex: '1 1 0', minHeight: 0, position: 'relative', overflow: 'hidden', contain: 'layout' }}>
        <PortalRootContext.Provider value={zone}>{children}</PortalRootContext.Provider>
      </div>
      {lowGpu && !dismissed && <GpuWarningBanner onClose={() => setDismissed(true)} />}
    </div>
  );
};
