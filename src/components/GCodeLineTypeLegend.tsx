import React from 'react';
import { motion } from 'framer-motion';
import clsx from 'clsx';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useExternalScrollThumb } from '@/hooks/use-external-scroll-thumb';
import { LINE_TYPES, type LineTypeId, type LineTypeVisibility } from './gcodeLineTypes';
import type { ColorByMode, ColorByRange, ContinuousColorByMode } from './gcodeLayer';
import { COLOR_BY_LABELS, COLOR_BY_UNITS, COLORMAP_STOPS_HEX, defaultColorByScope, type ColorByScope } from './gcodeColormap';
import type { GCodeFileInfo } from '@/hooks/use-gcode-preview';
import styles from './GCodeLineTypeLegend.module.scss';
import { ExternalScrollArea } from './ExternalScrollArea';

interface GCodeLineTypeLegendProps {
  /** G-code chargé (statistiques par type de ligne), ou null : toutes les valeurs en « — ». */
  fileInfo: GCodeFileInfo | null;
  visibility: LineTypeVisibility;
  onToggle: (id: LineTypeId, visible: boolean) => void;
  /** Critère de coloration actif du tracé (cf. gcodeColormap.ts). */
  colorBy: ColorByMode;
  setColorBy: (mode: ColorByMode) => void;
  /** Portée affichée (curseurs + écrêtage) du mode continu actif, ou null en mode `lineType`. */
  activeColorByScope: ColorByScope | null;
  setColorByScope: (mode: ContinuousColorByMode, scope: ColorByScope) => void;
  /** Bornes (mm) et valeur active du curseur « Précision du rendu », ou null hors mode continu. */
  renderPrecisionBounds: { min: number; max: number } | null;
  activeRenderPrecisionMm: number | null;
  setRenderPrecision: (mode: ContinuousColorByMode, mm: number | null) => void;
  /** Mode « sélectionner un point de trajectoire » actif, et sa bascule. */
  pickingPoint: boolean;
  onTogglePickPoint: () => void;
}

const DASH = '—';

const formatNumber = (value: number, digits: number) => value.toFixed(digits).replace('.', ',');

/** « 8 m 45 s », « 12 s » ; heures sans secondes (« 1 h 12 m ») pour tenir dans la colonne. */
const formatDuration = (seconds: number) => {
  const total = Math.round(seconds);
  if (total === 0) return '< 1 s';
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h} h ${m} m`;
  return m > 0 ? `${m} m ${s} s` : `${s} s`;
};

/** Valeur d'un mode continu, avec l'unité du mode — 2 décimales pour les grandeurs sous 10 (mm,
 * mm/mm...), sans décimale au-delà (mm/s, °C, %...) pour rester lisible. */
const formatColorByValue = (mode: ContinuousColorByMode, value: number) => {
  const digits = Math.abs(value) < 10 ? 2 : 0;
  return `${formatNumber(value, digits)} ${COLOR_BY_UNITS[mode]}`;
};

// Même cascade d'apparition que GCodeSpeedSelector (fondu-montée, easing « standard » Material).
const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.02 } },
};
const itemVariants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.22, ease: [0.4, 0, 0.2, 1] as const } },
};

/** Groupes du sélecteur « colorer par » (cf. GCodeColorBySelector) : le type de ligne reste seul et
 * toujours en tête, les modes continus sont classés par famille pour rester lisibles malgré leur
 * nombre (~13, trop pour un simple bouton segmenté). */
const COLOR_BY_GROUPS: { label: string; modes: ContinuousColorByMode[] }[] = [
  { label: 'Cinématique', modes: ['speed', 'accel', 'headAngle', 'segmentLength', 'elapsedTime'] },
  { label: 'Extrusion', modes: ['volumetricFlow', 'extrusionRatio', 'lineWidth', 'layerHeight'] },
  { label: 'Vitesse relative', modes: ['layerSpeedRatio'] },
  { label: 'Thermique / refroidissement', modes: ['temperature', 'fanSpeed'] },
];

const GRADIENT_CSS = `linear-gradient(90deg, ${COLORMAP_STOPS_HEX.join(', ')})`;
// Barre de la légende en mode continu : verticale (Min en bas, Max en haut — sens habituel d'une
// échelle thermique), donc la rampe est retournée par rapport à GRADIENT_CSS (horizontal, gauche à
// droite = bleu → rouge dans gcodeColormap.ts).
const VERTICAL_GRADIENT_CSS = `linear-gradient(0deg, ${COLORMAP_STOPS_HEX.join(', ')})`;

/**
 * Sélecteur du critère de coloration du tracé : pas de bandeau séparé — le libellé « Type de ligne »
 * de l'en-tête de colonne EST le déclencheur (cadre au survol + chevron), et prend le nom du mode
 * actif quand ce n'est plus le type de ligne. Menu construit sur le même design que les menus de
 * catégorie de CategoriesSidebar (sectionGroup/sectionTitle/itemsList/itemRow, curseur de défilement
 * externe — cf. useExternalScrollThumb) : groupé, trop d'options (type de ligne + une douzaine de
 * modes continus) pour un bouton segmenté à plat.
 */
const GCodeColorBySelector: React.FC<{ colorBy: ColorByMode; setColorBy: (mode: ColorByMode) => void }> = ({
  colorBy,
  setColorBy,
}) => {
  const [open, setOpen] = React.useState(false);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const { thumbHeight, thumbTop, hasScroll, isDragging, handleScroll, handleMouseDown } = useExternalScrollThumb(contentRef);
  const activeLabel = colorBy === 'lineType' ? 'Type de ligne' : COLOR_BY_LABELS[colorBy];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={styles.colorByTrigger}>
          <span>{activeLabel}</span>
          <svg className={styles.colorByChevron} width="8" height="5" viewBox="0 0 8 5" fill="none" aria-hidden>
            <path d="M1 1L4 4L7 1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className={styles.colorByMenu}
        align="start"
        sideOffset={6}
        collisionPadding={12}
        onMouseEnter={() => window.dispatchEvent(new CustomEvent('apex-reset-tooltip'))}
      >
        <div ref={contentRef} className={styles.colorByMenuContent} onScroll={handleScroll}>
          <ul className={styles.itemsList}>
            <li>
              <button
                type="button"
                className={clsx(styles.itemRow, styles.clickableRow, { [styles.activeItemRow]: colorBy === 'lineType' })}
                onClick={() => { setColorBy('lineType'); setOpen(false); }}
              >
                <span className={styles.itemName}>Type de ligne</span>
              </button>
            </li>
          </ul>
          {COLOR_BY_GROUPS.map((group) => (
            <div key={group.label} className={styles.sectionGroup}>
              <h4 className={styles.sectionTitle}>{group.label}</h4>
              <ul className={styles.itemsList}>
                {group.modes.map((mode) => (
                  <li key={mode}>
                    <button
                      type="button"
                      className={clsx(styles.itemRow, styles.clickableRow, { [styles.activeItemRow]: colorBy === mode })}
                      onClick={() => { setColorBy(mode); setOpen(false); }}
                    >
                      <span className={styles.itemName}>{COLOR_BY_LABELS[mode]}</span>
                      <span className={styles.colorByItemSwatch} style={{ background: GRADIENT_CSS }} aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        {hasScroll && (
          <div
            className={clsx(styles.externalScrollThumb, { [styles.dragging]: isDragging })}
            onMouseDown={handleMouseDown}
            style={{ height: `${thumbHeight}px`, top: `${thumbTop}px` }}
          />
        )}
      </PopoverContent>
    </Popover>
  );
};

interface GCodeGradientScaleProps {
  mode: ContinuousColorByMode;
  /** Bornes réelles du fichier pour ce mode : limites que les poignées ne peuvent pas dépasser. */
  fileRange: ColorByRange;
  /** Portée actuellement affichée (curseurs + écrêtage), déjà résolue sur les bornes du fichier si
   * l'utilisateur n'y a jamais touché (cf. `activeColorByScope` dans use-gcode-preview.ts). */
  scope: ColorByScope;
  setScope: (mode: ContinuousColorByMode, scope: ColorByScope) => void;
  precisionBounds: { min: number; max: number };
  activePrecisionMm: number | null;
  setPrecision: (mode: ContinuousColorByMode, mm: number | null) => void;
}

/** Fraction [0,1] de `value` dans `fileRange`, pour positionner une poignée le long de la barre. */
const fractionOf = (value: number, fileRange: ColorByRange) => {
  const span = fileRange.max - fileRange.min;
  return span > 1e-9 ? (value - fileRange.min) / span : 0.5;
};

// Crans du curseur de portée : incrément de base 1 unité (1 mm/s, 1°C, 1%...) sur l'essentiel de la
// plage, qui se réduit d'un facteur 10 par dixième de plage restant en se rapprochant de la borne
// minimale du fichier (le « bord petit ») — permet un réglage fin de valeurs proches de zéro/du bas
// de l'échelle (ex. hauteur de couche en mm) sans perdre les crans grossiers, lisibles au glisser,
// sur le reste de la plage (jamais plus fin que l'unité de base au-delà du premier dixième). Effet
// recherché en second lieu : moins de valeurs distinctes possibles → moins de recalculs du tampon
// de couleurs par sommet pendant le glisser (cf. GCodeGradientScale), qui masque le lag observé en
// rendant le mouvement du curseur volontairement saccadé plutôt que trahir la latence d'un recalcul
// à chaque pixel.
const RANGE_HANDLE_BASE_STEP = 1;
const snapRangeValue = (value: number, fileRange: ColorByRange) => {
  const span = fileRange.max - fileRange.min;
  if (!(span > 1e-9)) return value;
  const distFromMin = value - fileRange.min;
  // Fraction de plage restant jusqu'au minimum (0 = collé au minimum, 1 = un dixième de plage
  // au-dessus ou plus) : le cran ne s'affine que dans ce premier dixième, jamais au-delà.
  const nearMin = Math.min(1, distFromMin / (span * 0.1));
  // nearMin = 0 → step = BASE_STEP / 10 (le plus fin, collé au minimum) ; nearMin = 1 → step =
  // BASE_STEP (le cran normal, dès qu'on s'éloigne d'un dixième de plage du minimum).
  const step = RANGE_HANDLE_BASE_STEP / Math.pow(10, 1 - nearMin);
  const snapped = fileRange.min + Math.round(distFromMin / step) * step;
  return Math.max(fileRange.min, Math.min(fileRange.max, snapped));
};

/**
 * Barre de dégradé verticale + curseur double (min/max) + case « hors-portée en gris » : resserrer
 * les poignées RECADRE toute la rampe sur l'intervalle choisi (les valeurs qu'il contient s'étalent
 * sur tout le dégradé bleu→rouge), ce que la barre elle-même représente déjà en totalité — seules
 * les poignées se déplacent le long d'elle, positionnées par fraction des bornes RÉELLES du fichier
 * (`fileRange`), pour indiquer où se situe la portée choisie dans l'étendue complète des valeurs.
 */
const GCodeGradientScale: React.FC<GCodeGradientScaleProps> = ({
  mode, fileRange, scope, setScope, precisionBounds, activePrecisionMm, setPrecision,
}) => {
  const trackRef = React.useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = React.useState<'min' | 'max' | null>(null);

  // Poignées positionnées de BAS en HAUT (min en bas, max en haut — sens de VERTICAL_GRADIENT_CSS),
  // donc `bottom: fraction * 100%` plutôt que `top`.
  const minFraction = fractionOf(scope.min, fileRange);
  const maxFraction = fractionOf(scope.max, fileRange);

  const setFromClientY = (clientY: number, handle: 'min' | 'max') => {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const fraction = rect.height > 0 ? 1 - Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)) : 0;
    const value = snapRangeValue(fileRange.min + fraction * (fileRange.max - fileRange.min), fileRange);
    if (handle === 'min') {
      setScope(mode, { ...scope, min: Math.min(value, scope.max) });
    } else {
      setScope(mode, { ...scope, max: Math.max(value, scope.min) });
    }
  };

  const startDrag = (handle: 'min' | 'max') => (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(handle);
    setFromClientY(e.clientY, handle);
  };

  return (
    <div className={styles.gradientScaleWrap}>
      <div className={styles.gradientScale}>
        <div ref={trackRef} className={styles.gradientBarTrack}>
          {/* Piste grise pleine hauteur en dessous, bande de dégradé RECADRÉE entre les deux
              poignées par-dessus : au-delà de la portée choisie, le tracé n'est plus coloré par
              cette partie de la rampe (gris ou écrêté selon la case, cf. gcodeColormap.ts) — la
              barre doit donc représenter la même chose, pas le dégradé complet en permanence. La
              bande étale le dégradé complet sur SA PROPRE hauteur (bleu au minimum choisi, rouge au
              maximum choisi), exactement comme les couleurs qu'affiche le tracé recadré. */}
          <div className={styles.gradientBarOut} />
          <div
            className={styles.gradientBar}
            style={{
              background: VERTICAL_GRADIENT_CSS,
              top: `${(1 - maxFraction) * 100}%`,
              bottom: `${minFraction * 100}%`,
            }}
          />
          <div
            className={clsx(styles.gradientHandle, { [styles.gradientHandleActive]: dragging === 'max' })}
            style={{ bottom: `${maxFraction * 100}%` }}
            onPointerDown={startDrag('max')}
            onPointerMove={(e) => dragging === 'max' && setFromClientY(e.clientY, 'max')}
            onPointerUp={() => setDragging(null)}
            onDoubleClick={() => setScope(mode, { ...scope, max: fileRange.max })}
            role="slider"
            aria-label={`${COLOR_BY_LABELS[mode]} — borne maximale`}
            aria-valuemin={fileRange.min}
            aria-valuemax={fileRange.max}
            aria-valuenow={scope.max}
          />
          <div
            className={clsx(styles.gradientHandle, { [styles.gradientHandleActive]: dragging === 'min' })}
            style={{ bottom: `${minFraction * 100}%` }}
            onPointerDown={startDrag('min')}
            onPointerMove={(e) => dragging === 'min' && setFromClientY(e.clientY, 'min')}
            onPointerUp={() => setDragging(null)}
            onDoubleClick={() => setScope(mode, { ...scope, min: fileRange.min })}
            role="slider"
            aria-label={`${COLOR_BY_LABELS[mode]} — borne minimale`}
            aria-valuemin={fileRange.min}
            aria-valuemax={fileRange.max}
            aria-valuenow={scope.min}
          />
        </div>
        {/* Ordre visuel Max → Moy. → Min, du haut vers le bas, aligné sur le sens de la barre
            (rouge/max en haut, bleu/min en bas). Moy. reste la vraie moyenne du FICHIER (jamais
            recalculée sur la portée resserrée) : atténuée si elle tombe hors de la portée choisie,
            pour signaler qu'elle n'est plus représentative de ce qui est actuellement affiché. */}
        <div className={styles.gradientStats}>
          <div className={styles.gradientStat}>
            <span className={styles.gradientStatLabel}>Max</span>
            <span className={styles.gradientStatValue}>{formatColorByValue(mode, scope.max)}</span>
          </div>
          <div className={clsx(styles.gradientStat, {
            [styles.gradientStatOutOfScope]: fileRange.avg < scope.min || fileRange.avg > scope.max,
          })}
          >
            <span className={styles.gradientStatLabel}>Moy.</span>
            <span className={styles.gradientStatValue}>{formatColorByValue(mode, fileRange.avg)}</span>
          </div>
          <div className={styles.gradientStat}>
            <span className={styles.gradientStatLabel}>Min</span>
            <span className={styles.gradientStatValue}>{formatColorByValue(mode, scope.min)}</span>
          </div>
        </div>
      </div>
      <label
        className={styles.grayOutOfScopeRow}
        onMouseEnter={() => window.dispatchEvent(new CustomEvent('apex-set-tooltip', {
          detail: {
            title: 'Hors-portée en gris',
            desc: 'Coché : les trajectoires en dehors de la portée choisie sont grisées. Décoché : elles prennent la couleur la plus proche de la rampe (bleu en dessous du minimum, rouge au-dessus du maximum).',
          },
        }))}
        onMouseLeave={() => window.dispatchEvent(new CustomEvent('apex-reset-tooltip'))}
      >
        <input
          type="checkbox"
          className={styles.checkbox}
          checked={scope.grayOutOfScope}
          onChange={(e) => setScope(mode, { ...scope, grayOutOfScope: e.target.checked })}
        />
        <span>Hors-portée en gris</span>
      </label>
      <GCodeRenderPrecisionSlider
        mode={mode}
        bounds={precisionBounds}
        activeMm={activePrecisionMm}
        setPrecision={setPrecision}
      />
    </div>
  );
};

/**
 * Curseur « Précision du rendu » : longueur maximale (mm) d'un sous-segment cartésien avant d'être
 * encore subdivisé (cf. createSampler dans gcodeLayer.ts) — plus la valeur est petite, plus la
 * couleur peut changer finement le long d'un même mouvement, ce qui corrige l'effet de moiré visible
 * sur de longs traits quand un seul point de couleur existe par mouvement. Maximum = comportement
 * actuel (un anneau par mouvement, pas de subdivision, `activeMm = null`) ; minimum = 20× plus fin.
 * Reconstruit la géométrie des cordons (cf. gcodeLayer.ts setRenderPrecision) : volontairement
 * appliqué seulement au RELÂCHEMENT du curseur, jamais pendant le glisser (trop coûteux à répéter à
 * chaque pixel) — un état local suit le glisser pour l'affichage de la valeur, sans reconstruire.
 */
const GCodeRenderPrecisionSlider: React.FC<{
  mode: ContinuousColorByMode;
  bounds: { min: number; max: number };
  activeMm: number | null;
  setPrecision: (mode: ContinuousColorByMode, mm: number | null) => void;
}> = ({ mode, bounds, activeMm, setPrecision }) => {
  // null (comportement par défaut, pas encore réglé) affiché au maximum du curseur (le moins
  // précis) — cohérent avec `activeMm == null ⇔ comportement actuel` côté calque.
  const [localMm, setLocalMm] = React.useState(activeMm ?? bounds.max);
  React.useEffect(() => setLocalMm(activeMm ?? bounds.max), [activeMm, bounds.max]);

  const ratio = bounds.max > bounds.min ? (localMm - bounds.min) / (bounds.max - bounds.min) : 1;

  const commit = (mm: number) => {
    // Collé au maximum : redevient `null` (comportement par défaut), pas une valeur explicite égale
    // au maximum — évite une reconstruction inutile si l'utilisateur ramène juste le curseur au bout.
    setPrecision(mode, mm >= bounds.max - 1e-9 ? null : mm);
  };

  const setFromClientX = (clientX: number, track: HTMLDivElement) => {
    const rect = track.getBoundingClientRect();
    const localRatio = rect.width > 0 ? Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) : 1;
    setLocalMm(bounds.min + localRatio * (bounds.max - bounds.min));
  };

  return (
    <div
      className={styles.precisionRow}
      onMouseEnter={() => window.dispatchEvent(new CustomEvent('apex-set-tooltip', {
        detail: {
          title: 'Précision du rendu',
          desc: "Subdivise les mouvements pour que la couleur puisse changer plus finement le long du tracé — réduit l'effet de bandes visible sur les longs traits, au prix d'une géométrie plus lourde.",
        },
      }))}
      onMouseLeave={() => window.dispatchEvent(new CustomEvent('apex-reset-tooltip'))}
    >
      <div className={styles.precisionLabelRow}>
        <span className={styles.precisionLabel}>Précision du rendu</span>
        <span className={styles.precisionValue}>{formatNumber(localMm, localMm < 1 ? 3 : 2)} mm</span>
      </div>
      <div
        className={styles.precisionTrack}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setFromClientX(e.clientX, e.currentTarget);
        }}
        onPointerMove={(e) => { if (e.buttons === 1) setFromClientX(e.clientX, e.currentTarget); }}
        onPointerUp={() => commit(localMm)}
        onDoubleClick={() => { setLocalMm(bounds.max); setPrecision(mode, null); }}
        role="slider"
        aria-label="Précision du rendu"
        aria-valuemin={bounds.min}
        aria-valuemax={bounds.max}
        aria-valuenow={localMm}
      >
        <div className={styles.precisionTrackFill} style={{ width: `${ratio * 100}%` }} />
        <div className={styles.precisionHandle} style={{ left: `${ratio * 100}%` }} />
      </div>
    </div>
  );
};

/**
 * Légende de l'espace Prévisualisation, posée dans le panneau du haut de CategoriesSidebar : le
 * sélecteur « colorer par » en en-tête, puis le corps de la légende selon le mode actif —
 * couleur/durée/pourcentage/longueur/poids par type de ligne (défaut), ou dégradé + min/moyenne/max
 * pour un mode continu (cf. gcodeColormap.ts).
 */
export const GCodeLineTypeLegend = React.memo<GCodeLineTypeLegendProps>(({
  fileInfo, visibility, onToggle, colorBy, setColorBy, activeColorByScope, setColorByScope,
  renderPrecisionBounds, activeRenderPrecisionMm, setRenderPrecision, pickingPoint, onTogglePickPoint,
}) => {
  const totalTime = fileInfo?.totalTime ?? 0;
  const continuousMode = colorBy !== 'lineType' ? colorBy : null;
  const fileRange = continuousMode && fileInfo ? fileInfo.colorByRanges[continuousMode] : null;

  return (
    <motion.div className={styles.root} variants={containerVariants} initial="hidden" animate="visible">
      {!continuousMode ? (
        <>
          <motion.div className={clsx(styles.grid, styles.header)} variants={itemVariants}>
            <GCodeColorBySelector colorBy={colorBy} setColorBy={setColorBy} />
            <span className={styles.numeric}>Durée</span>
            <span className={styles.numeric}>Pourcentage</span>
            <span className={styles.numeric}>Longueur</span>
            <span className={styles.numeric}>Poids</span>
            <span />
          </motion.div>

          {fileInfo ? (
            <ExternalScrollArea className={styles.rowsArea} contentClassName={styles.rows}>
              {LINE_TYPES.map((type) => {
                const stat = fileInfo.lineStats[type.id];
                const hasTime = !!stat && stat.time > 0;
                const hasFilament = type.kind === 'extrusion' && !!stat && stat.filamentMm > 0;
                const visible = visibility[type.id];
                return (
                  <motion.label
                    key={type.id}
                    className={clsx(styles.grid, styles.row, { [styles.off]: !visible })}
                    variants={itemVariants}
                    onMouseEnter={() => window.dispatchEvent(new CustomEvent('apex-set-tooltip', {
                      detail: { title: type.label, desc: type.description },
                    }))}
                    onMouseLeave={() => window.dispatchEvent(new CustomEvent('apex-reset-tooltip'))}
                  >
                    <span className={styles.name}>
                      <span className={styles.swatch} style={{ backgroundColor: type.color }} />
                      <span className={styles.label}>{type.label}</span>
                    </span>
                    <span className={clsx(styles.numeric, { [styles.dash]: !hasTime })}>
                      {hasTime ? formatDuration(stat.time) : DASH}
                    </span>
                    <span className={clsx(styles.numeric, { [styles.dash]: !hasTime })}>
                      {hasTime && totalTime > 0 ? `${formatNumber((stat.time / totalTime) * 100, 1)}%` : DASH}
                    </span>
                    <span className={clsx(styles.numeric, { [styles.dash]: !hasFilament })}>
                      {hasFilament ? `${formatNumber(stat.filamentMm / 1000, 2)} m` : DASH}
                    </span>
                    <span className={clsx(styles.numeric, { [styles.dash]: !hasFilament })}>
                      {hasFilament ? `${formatNumber(stat.massG, 2)} g` : DASH}
                    </span>
                    <input
                      type="checkbox"
                      className={styles.checkbox}
                      checked={visible}
                      onChange={(e) => onToggle(type.id, e.target.checked)}
                      aria-label={`Afficher : ${type.label}`}
                    />
                  </motion.label>
                );
              })}
            </ExternalScrollArea>
          ) : (
            <motion.p className={styles.gradientEmpty} variants={itemVariants}>
              Aucun G-code chargé.
            </motion.p>
          )}
        </>
      ) : (
        <motion.div className={styles.gradientPanel} variants={itemVariants}>
          <div className={clsx(styles.grid, styles.header)}>
            <GCodeColorBySelector colorBy={colorBy} setColorBy={setColorBy} />
          </div>
          {fileRange && activeColorByScope && renderPrecisionBounds ? (
            <GCodeGradientScale
              mode={continuousMode}
              fileRange={fileRange}
              scope={activeColorByScope}
              setScope={setColorByScope}
              precisionBounds={renderPrecisionBounds}
              activePrecisionMm={activeRenderPrecisionMm}
              setPrecision={setRenderPrecision}
            />
          ) : (
            <p className={styles.gradientEmpty}>Aucun G-code chargé.</p>
          )}
        </motion.div>
      )}

      <motion.button
        type="button"
        className={clsx(styles.pickButton, { [styles.pickButtonActive]: pickingPoint })}
        variants={itemVariants}
        disabled={!fileInfo}
        aria-pressed={pickingPoint}
        onClick={onTogglePickPoint}
        onMouseEnter={() => window.dispatchEvent(new CustomEvent('apex-set-tooltip', {
          detail: {
            title: 'Sélectionner un point de trajectoire à visualiser',
            desc: "Cliquez sur un point de la trajectoire, sur le modèle : la lecture saute à l'instant où la tête l'imprime. Échap pour annuler.",
          },
        }))}
        onMouseLeave={() => window.dispatchEvent(new CustomEvent('apex-reset-tooltip'))}
      >
        {pickingPoint ? 'Cliquez un point sur le modèle…' : 'Sélectionner un point de trajectoire à visualiser'}
      </motion.button>
    </motion.div>
  );
});
GCodeLineTypeLegend.displayName = 'GCodeLineTypeLegend';
