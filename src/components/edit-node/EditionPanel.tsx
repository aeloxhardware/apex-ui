import React, { useEffect, useMemo, useState } from 'react';
import { ClipboardPaste, Copy, Crosshair, Lock, LockOpen, Redo2, Save, Trash2, Undo2 } from 'lucide-react';
import type { EditFalloff } from '@/utils/editKernelClient';
import {
  DEFAULT_EDIT_INFLUENCE,
  DEFAULT_EDIT_SYMMETRY,
  DEFAULT_LOCK_RADIUS_MM,
  DEFAULT_MACHINE_LIMITS,
  EDIT_ANALYZE_EVENT,
  EDIT_CLEAR_LOCKS_EVENT,
  EDIT_COPY_EVENT,
  EDIT_INFLUENCE_EVENT,
  EDIT_LIMITS_EVENT,
  EDIT_LAYER_LIMITS_EVENT,
  EDIT_LOCK_MODE_EVENT,
  EDIT_PASTE_EVENT,
  EDIT_PLACE_EVENT,
  EDIT_REDO_EVENT,
  EDIT_REMOVE_NODE_EVENT,
  EDIT_REQUEST_STATE_EVENT,
  EDIT_SET_DELTA_EVENT,
  EDIT_STATE_EVENT,
  EDIT_SYMMETRY_EVENT,
  EDIT_UNDO_EVENT,
  EDIT_SAVE_EVENT,
  EDIT_FILE_INFO_EVENT,
  type EditFileInfo,
  type EditInfluenceSettings,
  type EditReachMode,
  type EditLockMode,
  type EditStateDetail,
  type EditSymmetryMode,
} from './editProtocol';
import type { MachineLimits } from '@/utils/machineLimits';
import { DEFAULT_LAYER_LIMITS, layerFloorMm, type LayerLimits } from '@/utils/layerLimits';
import { HeadAxisValues } from './HeadAxisValues';
import { bottomTip } from './bottomTooltip';
import { GlassSelect, type GlassSelectOption } from './GlassSelect';
import styles from './EditionPanel.module.scss';
import { ExternalScrollArea } from '../ExternalScrollArea';

/**
 * Onglet Édition de Prévisualisation : pose du nœud, réglages d'influence, valeurs exactes du
 * déplacement (saisissables), épaisseurs, rognage, verrous, symétrie, validation physique et
 * historique. Ne parle à la vue 3D que par les événements `apex-edit-*` (editProtocol.ts) ; le calcul
 * est fait par le noyau C++.
 */

const FALLOFFS: GlassSelectOption<EditFalloff>[] = [
  {
    value: 'cubic',
    label: 'Cubique',
    tip: 'Les points proches du nœud le suivent presque entièrement, puis l’effet baisse au milieu et s’éteint en douceur au bord de la portée. Donne une bosse arrondie, sans cassure. Le bon choix par défaut.',
  },
  {
    value: 'gaussian',
    label: 'Gaussienne',
    tip: 'L’effet baisse dès qu’on s’éloigne du nœud, en forme de cloche. La déformation se concentre autour du nœud : bosse plus pointue.',
  },
  {
    value: 'linear',
    label: 'Linéaire',
    tip: 'L’effet baisse régulièrement, en ligne droite, du nœud jusqu’au bord de la portée. Simple à prévoir, mais laisse un angle visible au nœud et au bord.',
  },
  {
    value: 'plateau',
    label: 'Plateau',
    tip: 'Tout ce qui est à moins de la moitié de la portée bouge d’un bloc avec le nœud, puis l’effet s’éteint en douceur. Pour déplacer une zone entière sans la déformer.',
  },
];

const EXTRUSION_CHOICES: GlassSelectOption<'off' | 'auto' | 'manual'>[] = [
  {
    value: 'off',
    label: 'Désactivée (E d’origine)',
    tip: 'La quantité de filament déposée reste celle du fichier, même si la déformation allonge les trajectoires ou épaissit les couches. Risque de manque ou d’excès de matière.',
  },
  {
    value: 'auto',
    label: 'Automatique',
    tip: 'La quantité de filament est recalculée pour chaque segment déformé, selon sa nouvelle longueur et la nouvelle épaisseur de sa couche : la matière déposée reste juste.',
  },
  {
    value: 'manual',
    label: 'Automatique + facteur',
    tip: 'Comme Automatique, mais la correction est multipliée par un facteur que vous réglez : 1 = automatique, 0 = filament d’origine, plus de 1 = correction renforcée.',
  },
];

const REACH_MODE_CHOICES: GlassSelectOption<EditReachMode>[] = [
  {
    value: 'reach',
    label: 'Portée',
    tip: 'L’influence reste dans la portée fixée par les poignées. Quand les couches de cette zone ne peuvent plus absorber le déplacement (épaisseur minimale ou maximale atteinte), le nœud freine et s’arrête.',
  },
  {
    value: 'auto',
    label: 'Auto',
    tip: 'La portée des poignées n’est qu’un point de départ : quand elle ne suffit pas, l’influence s’élargit autant qu’il faut, jusqu’à tout l’objet, pour que le nœud atteigne la trajectoire voulue. Le nœud ne freine que si tout l’objet ne peut plus absorber le déplacement.',
  },
];

const COMBINE_CHOICES: GlassSelectOption<'product' | 'max'>[] = [
  {
    value: 'product',
    label: 'Produit (intersection)',
    tip: 'Un point n’est déformé que s’il est atteint par TOUS les critères cochés (distance, le long du cordon, trajectoires adjacentes). Chaque critère restreint la zone.',
  },
  {
    value: 'max',
    label: 'Maximum (union)',
    tip: 'Un point est déformé dès qu’UN des critères cochés l’atteint, avec l’effet le plus fort des critères. Chaque critère agrandit la zone.',
  },
];

const SYMMETRY_CHOICES: GlassSelectOption<EditSymmetryMode>[] = [
  {
    value: 'none',
    label: 'Aucune',
    tip: 'La déformation ne s’applique qu’au nœud.',
  },
  {
    value: 'cyclic',
    label: 'Cyclique',
    tip: 'La déformation validée est répétée autour de l’axe du plateau, tous les 360° / N : à chaque copie, le nœud, ses poignées et le déplacement tournent d’autant. Une copie sans trajectoire à moins de 1,5 mm est ignorée.',
  },
  {
    value: 'mirror',
    label: 'Miroir',
    tip: 'La déformation validée est répétée de l’autre côté d’un plan vertical qui contient l’axe du plateau (angle C choisi) : positions et déplacements sont réfléchis.',
  },
];

const send = (name: string, detail?: unknown) => window.dispatchEvent(new CustomEvent(name, { detail }));

const initialState: EditStateDetail = {
  status: 'inactive', message: null, placing: false, hasNode: false, busy: false,
  undoDepth: 0, redoDepth: 0, affected: 0, delta: null, influence: DEFAULT_EDIT_INFLUENCE,
  nodeTrimming: null, trimmed: 0, thickness: null, validation: null,
  locks: 0, lockMode: null, lockRadiusMm: DEFAULT_LOCK_RADIUS_MM, canPaste: false,
  symmetry: DEFAULT_EDIT_SYMMETRY, limits: DEFAULT_MACHINE_LIMITS, headModel: false,
  layerLimits: DEFAULT_LAYER_LIMITS, capacityMm: null, requestedAxialMm: null,
  reslicePoints: 0, resliceMaxCount: 0,
};

const DELTA_TIPS: Record<string, string> = {
  'ΔR': 'Écart du rayon du point du nœud (mm). Saisir une valeur puis Entrée : le point est déplacé exactement de ce déplacement et validé ; Tab : aperçu seulement.',
  'ΔC': 'Écart de l’angle du plateau du point du nœud (°). Saisir puis Entrée pour valider.',
  'ΔZ': 'Écart de hauteur du point du nœud (mm). Saisir puis Entrée pour valider.',
  'ΔB': 'Écart d’inclinaison de la tête au point du nœud (°). Saisi seul : la tête s’incline autour de la pointe (la pointe reste en place, R et Z s’ajustent) et les points voisins tournent avec elle. Saisi avec ΔR ou ΔZ : valeurs firmware littérales (B décrit un arc autour du pivot de 46 mm). Entrée pour valider.',
};

const STATUS_TEXT: Record<EditStateDetail['status'], string> = {
  inactive: 'Aucun G-code affiché.',
  unavailable: "Disponible dans l'application de bureau.",
  unsupported: "Réservé aux G-code polaires de l'Apex.",
  loading: 'Préparation du noyau d’édition…',
  ready: '',
  error: 'Noyau d’édition indisponible.',
};

const fmtSigned = (v: number, digits: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}`;
const fmtMm = (v: number) => v.toFixed(3).replace('.', ',');

/** Champ numérique : texte libre pendant la saisie, valeur du noyau sinon ; Entrée valide, Tab applique l'aperçu. */
const NumberField: React.FC<{
  value: number | undefined;
  digits: number;
  className?: string;
  disabled?: boolean;
  min?: number;
  max?: number;
  step?: number;
  ariaLabel: string;
  signed?: boolean;
  onCommit: (value: number, enter: boolean) => void;
}> = ({ value, digits, className, disabled, min, max, step, ariaLabel, signed, onCommit }) => {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? (value === undefined || !Number.isFinite(value) ? '' : signed ? fmtSigned(value, digits) : value.toFixed(digits));
  const finish = (enter: boolean) => {
    if (text === null) return;
    const parsed = parseFloat(text.replace(',', '.').replace('−', '-'));
    setText(null);
    if (Number.isFinite(parsed) && (min === undefined || parsed >= min) && (max === undefined || parsed <= max)) {
      onCommit(parsed, enter);
    }
  };
  return (
    <input
      className={className}
      type="text"
      inputMode="decimal"
      aria-label={ariaLabel}
      disabled={disabled}
      value={shown}
      step={step}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { finish(true); e.currentTarget.blur(); }
        else if (e.key === 'Escape') { setText(null); e.currentTarget.blur(); }
        e.stopPropagation();
      }}
      onBlur={() => finish(false)}
    />
  );
};

/** Courbe de l'écart tête / normale le long de la zone jugée (échantillonnée par le noyau). */
const NormalGraph: React.FC<{ indices: Uint32Array; values: Float32Array; worst: number }> = ({ indices, values, worst }) => {
  const path = useMemo(() => {
    const n = values.length;
    if (n < 2) return '';
    const top = Math.max(5, Math.ceil(worst / 5) * 5);
    const i0 = indices[0], i1 = indices[n - 1];
    const span = Math.max(1, i1 - i0);
    let d = '';
    for (let i = 0; i < n; i++) {
      const x = ((indices[i] - i0) / span) * 100;
      const y = 40 - (Math.min(values[i], top) / top) * 38;
      d += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)} `;
    }
    return d;
  }, [indices, values, worst]);
  if (!path) return <div className={styles.help}>Pas assez de points pour tracer l’écart.</div>;
  const top = Math.max(5, Math.ceil(worst / 5) * 5);
  return (
    <div className={styles.graphWrap}>
      <svg className={styles.graph} viewBox="0 0 100 42" preserveAspectRatio="none" role="img" aria-label="Écart entre l’axe de tête et la normale de couche">
        <line x1="0" y1="40" x2="100" y2="40" className={styles.graphAxis} />
        <path d={path} className={styles.graphLine} vectorEffect="non-scaling-stroke" />
      </svg>
      <span className={styles.graphMax}>{top}°</span>
    </div>
  );
};

export const EditionPanel: React.FC = () => {
  const [state, setState] = useState<EditStateDetail>(initialState);
  const [file, setFile] = useState<EditFileInfo>({ name: null, canSaveInPlace: false });
  const [normalsHelp, setNormalsHelp] = useState(false);

  useEffect(() => {
    const onState = (e: Event) => setState((e as CustomEvent<EditStateDetail>).detail);
    const onFile = (e: Event) => setFile((e as CustomEvent<EditFileInfo>).detail);
    window.addEventListener(EDIT_STATE_EVENT, onState);
    window.addEventListener(EDIT_FILE_INFO_EVENT, onFile);
    send(EDIT_REQUEST_STATE_EVENT);
    return () => {
      window.removeEventListener(EDIT_STATE_EVENT, onState);
      window.removeEventListener(EDIT_FILE_INFO_EVENT, onFile);
    };
  }, []);

  const ready = state.status === 'ready';
  const influence = state.influence;
  const extrusion = influence.extrusion ?? { mode: 'auto' as const, factor: 1 };
  const [manualFactor, setManualFactor] = useState(false);
  const extrusionChoice = extrusion.mode === 'off' ? 'off' : manualFactor || extrusion.factor !== 1 ? 'manual' : 'auto';
  const setInfluence = (next: EditInfluenceSettings) => send(EDIT_INFLUENCE_EVENT, { influence: next });
  const setLimits = (next: MachineLimits) => send(EDIT_LIMITS_EVENT, { limits: next });
  const setLockMode = (mode: EditLockMode, radiusMm = state.lockRadiusMm) => send(EDIT_LOCK_MODE_EVENT, { mode, radiusMm });
  const setSymmetry = (patch: Partial<EditStateDetail['symmetry']>) => send(EDIT_SYMMETRY_EVENT, { symmetry: { ...state.symmetry, ...patch } });

  const metric = (
    key: 'spatial' | 'along',
    label: string,
    hint: string,
  ) => {
    const m = influence[key];
    return (
      <div className={styles.metric}>
        <label className={styles.check} {...bottomTip(label, hint)}>
          <input
            type="checkbox"
            checked={m.enabled}
            disabled={!ready}
            onChange={(e) => setInfluence({ ...influence, [key]: { ...m, enabled: e.target.checked } })}
          />
          {label}
        </label>
        <input
          className={styles.number}
          type="number"
          min={0}
          step={0.1}
          value={m.radiusMm}
          disabled={!ready || !m.enabled}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (Number.isFinite(v) && v >= 0) setInfluence({ ...influence, [key]: { ...m, radiusMm: v } });
          }}
        />
        <span className={styles.unit}>mm</span>
        <GlassSelect
          className={styles.select}
          value={m.falloff}
          options={FALLOFFS}
          disabled={!ready || !m.enabled}
          ariaLabel={`Décroissance — ${label}`}
          onChange={(falloff) => setInfluence({ ...influence, [key]: { ...m, falloff } })}
          {...bottomTip('Décroissance', 'Forme de la baisse de l’influence avec la distance : cubique, gaussienne, linéaire ou plateau.')}
        />
      </div>
    );
  };

  const adj = influence.adjacency;
  const v = state.validation;
  const th = state.thickness;
  const limits = state.limits;
  const layerLimits = state.layerLimits;
  const layerField = (
    key: keyof LayerLimits, label: string, unit: string, tip: string, digits = 2,
  ) => (
    <div className={styles.field} {...bottomTip(label, tip)}>
      <span className={styles.fieldName}>{label}</span>
      <NumberField
        className={styles.deltaInput}
        value={layerLimits[key]}
        digits={digits}
        ariaLabel={label}
        disabled={!ready}
        onCommit={(value) => send(EDIT_LAYER_LIMITS_EVENT, { layerLimits: { ...layerLimits, [key]: value } })}
      />
      <span className={styles.unit}>{unit}</span>
    </div>
  );
  const limitField = (
    key: keyof MachineLimits, label: string, unit: string, tip: string, digits = 1,
  ) => (
    <div className={styles.field} {...bottomTip(label, tip)}>
      <span className={styles.fieldName}>{label}</span>
      <NumberField
        className={styles.deltaInput}
        value={limits[key]}
        digits={digits}
        ariaLabel={label}
        disabled={!ready}
        onCommit={(value) => setLimits({ ...limits, [key]: value })}
      />
      <span className={styles.unit}>{unit}</span>
    </div>
  );

  return (
    <div className={styles.frame}>
    <ExternalScrollArea className={styles.scrollArea} contentClassName={styles.root}>
      <div className={styles.toolbar}>
        <button
          type="button"
          className={`${styles.button} ${state.placing ? styles.on : ''}`}
          disabled={!ready}
          onClick={() => send(EDIT_PLACE_EVENT, { active: !state.placing })}
          {...bottomTip('Placer un nœud', 'Cliquer ensuite sur la trajectoire pour y poser un nœud. Le nœud déjà posé se réduit et reste disponible.')}
        >
          <Crosshair size={14} /> {state.placing ? 'Cliquer sur la trajectoire…' : 'Placer un nœud'}
        </button>
        <button
          type="button"
          className={styles.icon}
          disabled={!state.hasNode}
          onClick={() => send(EDIT_REMOVE_NODE_EVENT)}
          {...bottomTip('Supprimer le nœud', 'Supprime le nœud développé. Échap le réduit seulement.')}
        >
          <Trash2 size={14} />
        </button>
        <button
          type="button"
          className={styles.icon}
          disabled={!ready || !state.hasNode}
          onClick={() => send(EDIT_COPY_EVENT)}
          {...bottomTip('Copier la déformation', 'Copie le déplacement et la rotation du nœud (avant validation), exprimés dans le repère de sa tête : axe de tête, radial, tangentiel. Les poignées ne sont pas copiées.')}
        >
          <Copy size={14} />
        </button>
        <button
          type="button"
          className={styles.icon}
          disabled={!ready || !state.hasNode || !state.canPaste}
          onClick={() => send(EDIT_PASTE_EVENT)}
          {...bottomTip('Coller la déformation', 'Applique la déformation copiée au nœud actif, dans le repère de sa tête, et la valide.')}
        >
          <ClipboardPaste size={14} />
        </button>
        <span className={styles.spacer} />
        {/* G-code tranché par Apex : modifié en place ; importé : EXPORT COPY seulement (D4, D6). */}
        <button
          type="button"
          className={styles.button}
          disabled={!ready}
          onClick={() => send(EDIT_SAVE_EVENT, { mode: file.canSaveInPlace ? 'inplace' : 'copy' })}
          {...(file.canSaveInPlace
            ? bottomTip('Enregistrer', 'G-code tranché par Apex : le fichier est modifié en place.')
            : bottomTip('EXPORT COPY', 'G-code importé : le fichier d’origine n’est pas modifié, une copie modifiée est enregistrée.'))}
        >
          <Save size={14} /> {file.canSaveInPlace ? 'Enregistrer' : 'EXPORT COPY'}
        </button>
        <button
          type="button"
          className={styles.icon}
          disabled={!ready || state.undoDepth === 0}
          onClick={() => send(EDIT_UNDO_EVENT)}
          {...bottomTip('Annuler', `Ctrl+Z. ${state.undoDepth} modification(s) à annuler.`)}
        >
          <Undo2 size={14} />
        </button>
        <button
          type="button"
          className={styles.icon}
          disabled={!ready || state.redoDepth === 0}
          onClick={() => send(EDIT_REDO_EVENT)}
          {...bottomTip('Rétablir', `Ctrl+Y. ${state.redoDepth} modification(s) à rétablir.`)}
        >
          <Redo2 size={14} />
        </button>
      </div>

      {!ready || state.message ? (
        <div className={styles.status}>{state.message ?? STATUS_TEXT[state.status]}</div>
      ) : null}

      <HeadAxisValues />

      <div className={styles.deltaEdit}>
        {([
          ['ΔR', 'r', state.delta?.r, 3, 'mm'],
          ['ΔC', 'c', state.delta?.c, 2, '°'],
          ['ΔZ', 'z', state.delta?.z, 3, 'mm'],
          ['ΔB', 'b', state.delta?.b, 2, '°'],
        ] as const).map(([name, key, val, digits, unit]) => (
          <div key={name} className={styles.field} {...bottomTip(name, DELTA_TIPS[name])}>
            <span className={styles.fieldName}>{name}</span>
            <NumberField
              className={styles.deltaInput}
              value={state.hasNode ? (val ?? 0) : undefined}
              digits={digits}
              signed
              ariaLabel={`Déplacement ${name}`}
              disabled={!ready || !state.hasNode}
              onCommit={(value, enter) => send(EDIT_SET_DELTA_EVENT, { values: { [key]: value }, commit: enter })}
            />
            <span className={styles.unit}>{unit}</span>
          </div>
        ))}
        <div className={styles.field} {...bottomTip('E', 'Extrusion du segment du nœud par rapport à l’origine, recalculée par le noyau selon sa longueur et son épaisseur.')}>
          <span className={styles.fieldName}>E</span>
          <span className={styles.fieldValue}>
            {state.delta && Number.isFinite(state.delta.eRatio) ? `${(state.delta.eRatio * 100).toFixed(0)}` : '—'}
          </span>
          <span className={styles.unit}>%</span>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>
          Épaisseur de couche
          <span className={styles.count}>limites {fmtMm(th ? th.minLimit : layerFloorMm(layerLimits))} – {fmtMm(th ? th.maxLimit : layerLimits.maxMm)} mm</span>
        </div>
        <div className={styles.limits}>
          {layerField('minMm', 'Min', 'mm', 'Épaisseur de couche minimale. Au-dessous, la couche est écrasée : le nœud freine.', 3)}
          {layerField('maxMm', 'Max', 'mm', 'Épaisseur de couche maximale (en général 75 % du diamètre de buse). C’est elle qui borne l’étirement : chaque couche n’absorbe que (max − épaisseur).', 3)}
          {layerField('widthFactor', 'Largeur ×', '', 'Largeur variable : une couche peut descendre jusqu’à min ÷ facteur en élargissant son cordon (jusqu’à facteur × la largeur nominale), avec une extrusion recalculée pour garder la section. 1 : bornes strictes.', 2)}
        </div>
        <div className={styles.metric}>
          <label className={styles.check} {...bottomTip('Re-tranchage', 'Au-delà de l’épaisseur maximale, des couches sont interpolées entre le point et son support au lieu de freiner l’étirement : des passes partielles sont insérées dans le G-code à la validation. Le fichier est alors réécrit et rechargé (annulable). Sans effet avec le rognage du nœud.')}>
            <input
              type="checkbox"
              checked={influence.reslice !== false}
              disabled={!ready}
              onChange={(e) => setInfluence({ ...influence, reslice: e.target.checked })}
            />
            Interpoler des couches au-delà du maximum
          </label>
        </div>
        {influence.reslice !== false && (
          <div className={styles.limits}>
            <div className={styles.field} {...bottomTip('Couches insérées au plus', 'Nombre maximal de couches insérées par intervalle de couches : l’étirement est borné par (n + 1) × l’épaisseur maximale.')}>
              <span className={styles.fieldName}>Couches +</span>
              <NumberField
                className={styles.deltaInput}
                value={influence.resliceMaxLayers ?? 4}
                digits={0}
                ariaLabel="Couches insérées au plus"
                disabled={!ready}
                onCommit={(value) => {
                  const n = Math.round(value);
                  if (n >= 1 && n <= 12) setInfluence({ ...influence, resliceMaxLayers: n });
                }}
              />
              <span className={styles.unit} />
            </div>
          </div>
        )}
        {state.reslicePoints > 0 && (
          <div className={styles.chips} {...bottomTip('Couches à insérer', 'Points dont l’épaisseur dépasse le maximum : à la validation, jusqu’à ce nombre de couches interpolées s’insèrent sous eux. Orange sur le tracé.')}>
            <span className={`${styles.chip} ${styles.thicker}`}>
              {state.reslicePoints.toLocaleString('fr-FR')} points : jusqu’à {state.resliceMaxCount} couche(s) insérée(s)
            </span>
          </div>
        )}
        {state.hasNode && state.capacityMm !== null && (
          <div className={styles.chips} {...bottomTip('Capacité', 'Déplacement le long de l’empilement que les couches de la portée peuvent absorber avant d’atteindre leurs bornes d’épaisseur : l’étirement des couches d’un côté du nœud et la compression de l’autre se compensent, le plus petit des deux limite. Une portée plus grande, un maximum plus élevé ou la largeur variable l’augmentent.')}>
            <span className={`${styles.chip} ${state.requestedAxialMm !== null && state.requestedAxialMm > state.capacityMm + 1e-6 ? styles.alert : ''}`}>
              capacité {fmtMm(state.capacityMm)} mm{state.requestedAxialMm !== null ? ` · demandé ${fmtMm(state.requestedAxialMm)} mm` : ''}
            </span>
          </div>
        )}
        {th && (
          <div className={styles.chips} {...bottomTip('Épaisseur de couche', 'Épaisseur des couches touchées par la déformation en cours, calculée par le noyau. Aperçu sur le tracé : bleu = plus fine, orange = plus épaisse, rouge hachuré = hors des limites.')}>
            {th.node !== null && (
              <span className={styles.chip}>
                nœud {th.nodeBefore !== null ? `${fmtMm(th.nodeBefore)} → ` : ''}{fmtMm(th.node)} mm
              </span>
            )}
            <span className={styles.chip}>min {fmtMm(th.min)}</span>
            <span className={styles.chip}>max {fmtMm(th.max)}</span>
            {th.thinner > 0 && <span className={`${styles.chip} ${styles.thinner}`}>{th.thinner.toLocaleString('fr-FR')} plus fines</span>}
            {th.thicker > 0 && <span className={`${styles.chip} ${styles.thicker}`}>{th.thicker.toLocaleString('fr-FR')} plus épaisses</span>}
            {th.outOfBounds > 0 && <span className={`${styles.chip} ${styles.alert}`}>{th.outOfBounds.toLocaleString('fr-FR')} hors limites</span>}
          </div>
        )}
      </div>

      <div className={styles.metric}>
        <span className={styles.check} {...bottomTip('Extrusion', 'Recalcul de l’extrusion des segments déformés, au prorata de leur longueur et de leur épaisseur.')}>
          Extrusion
        </span>
        <GlassSelect
          className={styles.select}
          value={extrusionChoice}
          options={EXTRUSION_CHOICES}
          disabled={!ready}
          ariaLabel="Extrusion"
          {...bottomTip('Extrusion', 'Quantité de filament des segments déformés : gardée telle quelle, recalculée automatiquement, ou recalculée avec un facteur. Survolez chaque choix pour le détail.')}
          onChange={(choice) => {
            setManualFactor(choice === 'manual');
            setInfluence({
              ...influence,
              extrusion: { mode: choice === 'off' ? 'off' : 'auto', factor: choice === 'manual' ? extrusion.factor : 1 },
            });
          }}
        />
        {extrusionChoice === 'manual' && (
          <input
            className={styles.number}
            type="number"
            min={0}
            step={0.05}
            value={extrusion.factor}
            disabled={!ready}
            {...bottomTip('Facteur d’extrusion', 'Amplifie la correction : 1 = automatique, 0 = E d’origine.')}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              if (Number.isFinite(val) && val >= 0) setInfluence({ ...influence, extrusion: { mode: 'auto', factor: val } });
            }}
          />
        )}
      </div>

      <div className={styles.metric}>
        <label className={styles.check} {...bottomTip('Lissage de B', 'Après une déformation, chaque point touché rapproche son inclinaison B de la moyenne de ses voisins le long du cordon, au prorata de son poids. La pointe ne bouge pas ; le B du nœud reste exact. Réduit les à-coups de B (vitesse, accélération).')}>
          <input
            type="checkbox"
            checked={(influence.smoothB ?? 0) > 0}
            disabled={!ready}
            onChange={(e) => setInfluence({ ...influence, smoothB: e.target.checked ? 0.6 : 0 })}
          />
          Lissage automatique de B
        </label>
        <input
          className={styles.number}
          type="number"
          min={0}
          max={1}
          step={0.1}
          value={influence.smoothB ?? 0}
          disabled={!ready || (influence.smoothB ?? 0) <= 0}
          {...bottomTip('Force du lissage', 'De 0 (aucun) à 1 (fort).')}
          onChange={(e) => {
            const val = parseFloat(e.target.value);
            if (Number.isFinite(val) && val >= 0 && val <= 1) setInfluence({ ...influence, smoothB: val });
          }}
        />
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>
          Influence
          <span className={styles.count}>{state.hasNode ? `${state.affected.toLocaleString('fr-FR')} points` : ''}</span>
        </div>
        <div className={styles.metric}>
          <span className={styles.check}>Mode</span>
          <GlassSelect
            className={styles.select}
            value={influence.reachMode ?? 'reach'}
            options={REACH_MODE_CHOICES}
            disabled={!ready}
            ariaLabel="Mode d’influence"
            onChange={(reachMode) => setInfluence({ ...influence, reachMode })}
            {...bottomTip('Mode d’influence', 'Portée : l’influence ne dépasse pas la portée des poignées. Auto : elle s’élargit jusqu’à tout l’objet s’il le faut pour atteindre la trajectoire voulue.')}
          />
        </div>
        {metric('spatial', 'Distance 3D', 'Portée minimale dans toutes les directions ; chaque poignée l’allonge dans son sens (sa longueur).')}
        {metric('along', 'Le long du cordon', 'Distance parcourue le long des cordons, passage d’un cordon à l’autre compté par son seul décalage latéral.')}
        <div className={styles.metric}>
          <label className={styles.check} {...bottomTip('Trajectoires adjacentes', 'Nombre de trajectoires adjacentes franchies : celles déposées avant (supports) et après (posées dessus).')}>
            <input
              type="checkbox"
              checked={adj.enabled}
              disabled={!ready}
              onChange={(e) => setInfluence({ ...influence, adjacency: { ...adj, enabled: e.target.checked } })}
            />
            Trajectoires adjacentes
          </label>
          <input
            className={styles.number}
            type="number"
            min={0}
            step={1}
            value={adj.hopsBefore}
            disabled={!ready || !adj.enabled}
            {...bottomTip('Avant', 'Trajectoires déposées avant (supports) atteintes par l’influence.')}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10);
              if (val >= 0) setInfluence({ ...influence, adjacency: { ...adj, hopsBefore: val } });
            }}
          />
          <input
            className={styles.number}
            type="number"
            min={0}
            step={1}
            value={adj.hopsAfter}
            disabled={!ready || !adj.enabled}
            {...bottomTip('Après', 'Trajectoires déposées après (posées dessus) atteintes par l’influence.')}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10);
              if (val >= 0) setInfluence({ ...influence, adjacency: { ...adj, hopsAfter: val } });
            }}
          />
          <GlassSelect
            className={styles.select}
            value={adj.falloff}
            options={FALLOFFS}
            disabled={!ready || !adj.enabled}
            ariaLabel="Décroissance — trajectoires adjacentes"
            onChange={(falloff) => setInfluence({ ...influence, adjacency: { ...adj, falloff } })}
            {...bottomTip('Décroissance', 'Forme de la baisse de l’influence d’une trajectoire adjacente à l’autre.')}
          />
        </div>
        <div className={styles.metric}>
          <span className={styles.check}>Combinaison</span>
          <GlassSelect
            className={styles.select}
            value={influence.combine}
            options={COMBINE_CHOICES}
            disabled={!ready}
            ariaLabel="Combinaison"
            onChange={(combine) => setInfluence({ ...influence, combine })}
            {...bottomTip('Combinaison', 'Produit : les critères se restreignent. Maximum : ils s’étendent.')}
          />
        </div>
        <div className={styles.metric}>
          <label className={styles.check} {...bottomTip('Barrière de type de ligne', 'L’influence ne franchit pas les changements de type de ligne : seuls les points du même type que le nœud (paroi extérieure, remplissage, etc.) se déforment.')}>
            <input
              type="checkbox"
              checked={!!influence.typeBarrier}
              disabled={!ready}
              onChange={(e) => setInfluence({ ...influence, typeBarrier: e.target.checked })}
            />
            Barrière aux changements de type de ligne
          </label>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>
          Rognage
          <span className={styles.count}>
            {state.nodeTrimming === null ? '' : state.nodeTrimming ? 'actif sur ce nœud' : 'inactif sur ce nœud'}
            {state.trimmed > 0 ? ` · ${state.trimmed.toLocaleString('fr-FR')} dépôts rognés` : ''}
          </span>
        </div>
        <div className={styles.metric}>
          <span className={styles.check} {...bottomTip('Couches déformables', 'Rognage actif (double-clic sur le nœud) : seules la couche du nœud et ce nombre de couches au-dessus et au-dessous se déforment (0, par défaut : la couche du nœud seule). La matière fixe ne freine pas la déformation : ce qu’elle envahit est rogné (son extrusion est supprimée) au lieu d’être comprimé.')}>
            Couches déformables de chaque côté
          </span>
          <input
            className={styles.number}
            type="number"
            min={0}
            max={12}
            step={1}
            value={influence.trimLayers}
            disabled={!ready}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10);
              if (val >= 0 && val <= 12) setInfluence({ ...influence, trimLayers: val });
            }}
          />
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>
          Verrous
          <span className={styles.count}>{state.locks > 0 ? `${state.locks.toLocaleString('fr-FR')} points verrouillés` : ''}</span>
        </div>
        <div className={styles.metric}>
          <button
            type="button"
            className={`${styles.button} ${state.lockMode === 'lock' ? styles.on : ''}`}
            disabled={!ready}
            onClick={() => setLockMode(state.lockMode === 'lock' ? null : 'lock')}
            {...bottomTip('Verrouiller une zone', 'Cliquer ensuite sur la trajectoire : toute la matière à moins du rayon choisi du point devient immobile (gris hachuré). Un nœud ne peut pas y être posé.')}
          >
            <Lock size={13} /> Verrouiller
          </button>
          <button
            type="button"
            className={`${styles.button} ${state.lockMode === 'unlock' ? styles.on : ''}`}
            disabled={!ready || state.locks === 0}
            onClick={() => setLockMode(state.lockMode === 'unlock' ? null : 'unlock')}
            {...bottomTip('Déverrouiller une zone', 'Cliquer sur la trajectoire pour libérer la matière à moins du rayon choisi.')}
          >
            <LockOpen size={13} /> Libérer
          </button>
          <NumberField
            className={styles.number}
            value={state.lockRadiusMm}
            digits={1}
            min={0.1}
            ariaLabel="Rayon des zones verrouillées"
            disabled={!ready}
            onCommit={(value) => setLockMode(state.lockMode, value)}
          />
          <span className={styles.unit}>mm</span>
          <span className={styles.spacer} />
          <button
            type="button"
            className={styles.icon}
            disabled={!ready || state.locks === 0}
            onClick={() => send(EDIT_CLEAR_LOCKS_EVENT)}
            {...bottomTip('Tout déverrouiller', 'Libère toute la matière verrouillée.')}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Symétrie</div>
        <div className={styles.metric}>
          <GlassSelect
            className={styles.select}
            value={state.symmetry.mode}
            options={SYMMETRY_CHOICES}
            disabled={!ready}
            ariaLabel="Symétrie"
            onChange={(mode) => setSymmetry({ mode })}
            {...bottomTip('Symétrie', 'Répète chaque déformation validée en d’autres points : cyclique autour de l’axe du plateau, ou en miroir. Les copies s’annulent d’un coup avec la déformation.')}
          />
          {state.symmetry.mode === 'cyclic' && (
            <>
              <input
                className={styles.number}
                type="number"
                min={2}
                max={12}
                step={1}
                value={state.symmetry.count}
                disabled={!ready}
                {...bottomTip('Répétitions', 'Nombre de positions autour de l’axe du plateau (2 à 12), le nœud d’origine compris.')}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (val >= 2 && val <= 12) setSymmetry({ count: val });
                }}
              />
              <span className={styles.unit}>×</span>
            </>
          )}
          {state.symmetry.mode === 'mirror' && (
            <>
              <input
                className={styles.number}
                type="number"
                step={5}
                value={state.symmetry.mirrorDeg}
                disabled={!ready}
                {...bottomTip('Plan du miroir', 'Angle C (°) du plan vertical qui contient l’axe du plateau.')}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  if (Number.isFinite(val)) setSymmetry({ mirrorDeg: val });
                }}
              />
              <span className={styles.unit}>°</span>
            </>
          )}
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>
          Validité
          <span className={styles.count}>
            {v ? `${v.fileBViolations.toLocaleString('fr-FR')} point(s) hors limites de B dans le fichier` : ''}
          </span>
        </div>
        <div className={styles.limits}>
          {limitField('bMinDeg', 'B min', '°', 'Inclinaison minimale de la tête (profil de la machine).')}
          {limitField('bMaxDeg', 'B max', '°', 'Inclinaison maximale de la tête (profil de la machine : 185° sur l’Apex).')}
          {limitField('bSpeedDegS', 'B vit.', '°/s', 'Vitesse angulaire maximale de B.', 0)}
          {limitField('bAccelDegS2', 'B acc.', '°/s²', 'Accélération angulaire maximale de B.', 0)}
        </div>
        {v && (
          <div className={styles.chips} {...bottomTip('Zone modifiée', 'Points de la zone modifiée (ou du fichier après analyse) hors des limites de la machine. Rouge vif sur le tracé : réservé aux alertes.')}>
            <span className={`${styles.chip} ${v.bRange > 0 ? styles.alert : ''}`}>B hors plage {v.bRange}</span>
            <span className={`${styles.chip} ${v.bSpeed > 0 ? styles.alert : ''}`}>vitesse {v.timingKnown ? v.bSpeed : '—'}</span>
            <span className={`${styles.chip} ${v.bAccel > 0 ? styles.alert : ''}`}>accélération {v.timingKnown ? v.bAccel : '—'}</span>
            <span className={`${styles.chip} ${v.headPart > 0 ? styles.alert : ''}`}>tête / matière {v.collisionChecked ? v.headPart : '—'}</span>
            <span className={`${styles.chip} ${v.headPlate > 0 ? styles.alert : ''}`}>tête / plateau {v.collisionChecked ? v.headPlate : '—'}</span>
          </div>
        )}
        {!state.headModel && ready && (
          <div className={styles.help}>Collisions non contrôlées : le modèle de la tête n’est pas encore chargé.</div>
        )}
        <div className={styles.metric}>
          <button
            type="button"
            className={styles.button}
            disabled={!ready}
            onClick={() => send(EDIT_ANALYZE_EVENT, { collisions: false })}
            {...bottomTip('Analyser les limites de B', 'Contrôle tout le fichier : plage, vitesse et accélération de B. Les points en défaut sont marqués en rouge vif.')}
          >
            Analyser B
          </button>
          <button
            type="button"
            className={styles.button}
            disabled={!ready || !state.headModel}
            onClick={() => send(EDIT_ANALYZE_EVENT, { collisions: true })}
            {...bottomTip('Analyser aussi les collisions', 'Contrôle en plus la tête contre la matière déjà déposée et contre le plateau, sur un échantillon régulier de poses (jusqu’à 20 000).')}
          >
            + collisions
          </button>
        </div>
        {v && v.normalDeviation.length > 1 && (
          <>
            <div className={styles.sectionTitle}>
              <span>
                Écart tête / normale
                <button
                  type="button"
                  className={styles.helpButton}
                  aria-label="Qu’est-ce que la normale ?"
                  aria-expanded={normalsHelp}
                  onClick={() => setNormalsHelp((open) => !open)}
                  {...bottomTip('Normale', 'Cliquer pour afficher l’explication.')}
                >
                  ?
                </button>
              </span>
              <span className={styles.count}>pire écart {v.normalWorst.toFixed(1)}°</span>
            </div>
            {normalsHelp && (
              <div className={styles.helpBox}>
                La normale est la direction perpendiculaire à la couche sur laquelle repose le point : celle
                dans laquelle le matériau s’empile. En 5 axes, la tête doit rester alignée avec elle. L’écart
                est l’angle entre l’axe de la tête et cette normale (estimée par le noyau à partir des
                trajectoires qui portent le point) : 0° = tête exactement perpendiculaire à la couche. Un
                grand écart dépose la matière de biais et dégrade la couche.
              </div>
            )}
            <NormalGraph indices={v.normalIndices} values={v.normalDeviation} worst={v.normalWorst} />
          </>
        )}
      </div>

      <div className={styles.legendList}>
        <div className={styles.legend} {...bottomTip('Légende', 'Violet : poids de l’influence du nœud, de 0 (couleur neutre) à 1.')}>
          <span className={styles.ramp} />
          <span>Poids de l’influence, 0 → 1</span>
        </div>
        <div className={styles.legend} {...bottomTip('Légende', 'Gris hachuré : matière verrouillée, immobile.')}>
          <span className={`${styles.swatch} ${styles.swLocked}`} />
          <span>Matière verrouillée</span>
        </div>
        <div className={styles.legend} {...bottomTip('Légende', 'Rouge vif, réservé aux alertes : hors des limites de la machine, collision de la tête.')}>
          <span className={`${styles.swatch} ${styles.swAlert}`} />
          <span>Alerte : limites ou collision</span>
        </div>
        <div className={styles.legend} {...bottomTip('Légende', 'Bleu : couche plus fine. Orange : couche plus épaisse. Rouge hachuré : épaisseur hors des limites. Rouge sombre hachuré : dépôt qui serait rogné.')}>
          <span className={`${styles.swatch} ${styles.swThin}`} />
          <span className={`${styles.swatch} ${styles.swThick}`} />
          <span className={`${styles.swatch} ${styles.swBounds}`} />
          <span className={`${styles.swatch} ${styles.swTrim}`} />
          <span>Épaisseur · hors limites · rogné</span>
        </div>
      </div>
      <div className={styles.help}>
        L’objet garde sa forme : seule celle des couches change. Plateau et surface fixes, coques
        glissant sur leur paroi, épaisseur entre 0,06 et 0,3 mm (le nœud freine en approchant, en
        translation comme en rotation).
        Poignées : orientation = sens, longueur = portée ; clic = ancrage (orange). Double-clic sur le
        nœud : rognage.
      </div>
    </ExternalScrollArea>
    </div>
  );
};
