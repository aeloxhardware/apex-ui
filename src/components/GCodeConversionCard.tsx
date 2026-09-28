import React, { useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import clsx from 'clsx';
import { TriangleAlert, CircleCheck, CircleX, X } from 'lucide-react';
import type { ConversionMode } from './gcodeLayer';
import type { ConversionState } from '@/hooks/use-gcode-preview';
import styles from './GCodeConversionCard.module.scss';

interface ConversionSource {
  name: string;
  nonPlanar: boolean;
  /** Traits (suites de dépôts) qui finissent hors du plateau de l'Apex. */
  offPlateTraits: number;
}

interface GCodeConversionCardProps {
  /** G-code 3 axes chargé (convertible), ou null : carte masquée. */
  source: ConversionSource | null;
  conversion: ConversionState;
  onConvert: (mode: ConversionMode, dropOffPlate: boolean) => void;
  /** Surlignage rouge des traits hors plateau dans le viewport. */
  onHighlightOffPlate: (show: boolean) => void;
  /** Conversion possible ici (application de bureau, ou serveur de développement). */
  available: boolean;
}

const MODES: { id: ConversionMode; label: string; title: string; desc: string }[] = [
  {
    id: 'polar',
    label: 'Polaire',
    title: 'Conversion polaire',
    desc: 'Tête droite (B = 0) : chaque mouvement est converti en rayon, angle de plateau et hauteur. Pour les G-codes plans.',
  },
  {
    id: 'dynamic',
    label: 'Angle dynamique',
    title: 'Conversion polaire à angle dynamique',
    desc: "Incline la tête (±45°) selon la pente locale des couches, pour les G-codes non plans (tranchage courbe). Tient compte des 46 mm entre la pointe de buse et l'axe d'inclinaison.",
  },
];

/** Largeur du contenu de la carte dépliée : 440px (PREVIEW_W) moins le rembourrage. */
const EXPANDED_CONTENT_W = 416;
const PAD_X = 12;
const PAD_Y = 10;
const RESIZE_TRANSITION = { duration: 0.32, ease: [0.4, 0, 0.2, 1] as const };

const setTooltip = (title: string, desc: string) =>
  window.dispatchEvent(new CustomEvent('apex-set-tooltip', { detail: { title, desc } }));
const resetTooltip = () => window.dispatchEvent(new CustomEvent('apex-reset-tooltip'));

/**
 * Carte de conversion 3 axes → polaire de l'espace Prévisualisation, sous le panneau du bas de
 * CategoriesSidebar (cf. `previewBelowContent`) : avertissement, choix du mode, proposition de
 * supprimer les traits hors plateau, progression du script Python ; une fois converti, seul le
 * message de réussite reste, avec une croix pour fermer la carte.
 */
export const GCodeConversionCard: React.FC<GCodeConversionCardProps> = (props) => {
  // Fermée par sa croix pour ce fichier source ; réapparaît pour le suivant.
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const { source } = props;
  const visible = !!source && dismissedFor !== source.name;
  return (
    <AnimatePresence>
      {visible && (
        <CardBody key={source.name} {...props} source={source} onDismiss={() => setDismissedFor(source.name)} />
      )}
    </AnimatePresence>
  );
};

const CardBody: React.FC<GCodeConversionCardProps & { source: ConversionSource; onDismiss: () => void }> = ({
  source,
  conversion,
  onConvert,
  onHighlightOffPlate,
  available,
  onDismiss,
}) => {
  // Remonté à chaque nouveau fichier (`key`) : mode recommandé selon la planéité.
  const [mode, setMode] = useState<ConversionMode>(source.nonPlanar ? 'dynamic' : 'polar');
  const [confirmingOffPlate, setConfirmingOffPlate] = useState(false);
  const running = conversion.status === 'running';
  const done = conversion.status === 'done';
  const collapsed = done;

  // Taille animée d'après le contenu mesuré (texte jamais déformé, contrairement à `layout`).
  const contentRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const measuredRef = useRef(false);
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const measure = () => setSize({ width: el.offsetWidth + PAD_X * 2, height: el.offsetHeight + PAD_Y * 2 });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const firstSize = !measuredRef.current && !!size;
  if (size) measuredRef.current = true;

  const startConversion = () => {
    if (source.offPlateTraits > 0) {
      setConfirmingOffPlate(true);
      onHighlightOffPlate(true);
    } else {
      onConvert(mode, false);
    }
  };
  const answerOffPlate = (drop: boolean) => {
    setConfirmingOffPlate(false);
    // Le surlignage rouge reste affiché pendant la conversion (clignotant, cf. `convert` dans
    // use-gcode-preview.ts) — jamais éteint ici : les traits qui vont être retirés/convertis
    // restent visibles jusqu'au résultat, au lieu de disparaître dès la confirmation.
    onConvert(mode, drop);
  };

  let tone: 'warning' | 'success' | 'error' = 'warning';
  let message = "G-code 3 axes (cartésien) : l'imprimante sélectionnée imprime en coordonnées polaires. Convertissez-le avant l'export.";
  if (!available) {
    message = "G-code 3 axes (cartésien) : la conversion polaire est disponible dans l'application Apex.";
  } else if (confirmingOffPlate) {
    tone = 'error';
    message = source.offPlateTraits > 1
      ? `${source.offPlateTraits} traits sortent du plateau (Ø 250 mm), surlignés en rouge. Les supprimer avant la conversion ?`
      : 'Un trait sort du plateau (Ø 250 mm), surligné en rouge. Le supprimer avant la conversion ?';
  } else if (running) {
    message = `Conversion en coordonnées polaires${conversion.mode === 'dynamic' ? ' à angle dynamique' : ''}…`;
  } else if (done) {
    tone = 'success';
    message = `Converti en polaire${conversion.mode === 'dynamic' ? ' à angle dynamique' : ''} : prêt pour l'export.`;
  } else if (conversion.status === 'error') {
    tone = 'error';
    message = `La conversion a échoué : ${conversion.error}`;
  }
  const Icon = tone === 'success' ? CircleCheck : tone === 'error' && !confirmingOffPlate ? CircleX : TriangleAlert;

  return (
    <motion.div
      className={styles.card}
      data-apex-chrome-panel
      style={{ padding: `${PAD_Y}px ${PAD_X}px` }}
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0, ...(size ?? {}) }}
      exit={{ opacity: 0, x: -20 }}
      transition={{
        opacity: { duration: 0.26, ease: 'easeInOut' },
        x: { duration: 0.26, ease: 'easeInOut' },
        width: firstSize ? { duration: 0 } : RESIZE_TRANSITION,
        height: firstSize ? { duration: 0 } : RESIZE_TRANSITION,
      }}
    >
      <div
        ref={contentRef}
        className={clsx(styles.content, { [styles.collapsed]: collapsed })}
        style={{ width: collapsed ? 'max-content' : EXPANDED_CONTENT_W }}
      >
        <div className={styles.message}>
          <Icon size={16} className={clsx(styles.icon, styles[tone])} />
          <p title={message}>{message}</p>
          {collapsed && (
            <button type="button" className={styles.close} onClick={onDismiss} aria-label="Fermer">
              <X size={14} />
            </button>
          )}
        </div>

        {!collapsed && (confirmingOffPlate ? (
          <div className={styles.controls}>
            <button type="button" className={styles.secondaryButton} onClick={() => answerOffPlate(false)}>
              Conserver
            </button>
            <button type="button" className={clsx(styles.convertButton, styles.danger)} onClick={() => answerOffPlate(true)}>
              {source.offPlateTraits > 1 ? 'Supprimer les traits' : 'Supprimer le trait'}
            </button>
          </div>
        ) : (
          <div className={styles.controls}>
            <div className={styles.segments} role="radiogroup" aria-label="Mode de conversion">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={mode === m.id}
                  className={clsx(styles.segment, { [styles.active]: mode === m.id })}
                  disabled={running}
                  onClick={() => setMode(m.id)}
                  onMouseEnter={() => setTooltip(m.title, m.desc)}
                  onMouseLeave={resetTooltip}
                >
                  {m.label}
                  {m.id === 'dynamic' && source.nonPlanar && <span className={styles.tag}>recommandé</span>}
                </button>
              ))}
            </div>
            <button
              type="button"
              className={styles.convertButton}
              disabled={!available || running}
              onClick={startConversion}
            >
              {running ? `Conversion… ${conversion.progress} %` : 'Convertir'}
            </button>
          </div>
        ))}
      </div>
      {running && <div className={styles.progress} style={{ width: `${conversion.progress}%` }} />}
    </motion.div>
  );
};
