import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Info } from 'lucide-react';
import clsx from 'clsx';
import { CustomTooltip } from './CustomTooltip';
import { ExtrudeIcon } from './ModelingIcons';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import styles from './ExtrudePanel.module.scss';
import type { Vec3 } from '@/modeling/types';

export type ExtrudeBodyType = 'solid' | 'surface';
export type ExtrudeStart = 'profile' | 'offset';
export type ExtrudeDirection = 'one' | 'symmetric';
export type ExtrudeExtent = 'distance';
export type ExtrudeOperation = 'new-body' | 'join' | 'cut' | 'intersect';

export interface ExtrudeParams {
  bodyType: ExtrudeBodyType;
  startFrom: ExtrudeStart;
  direction: ExtrudeDirection;
  extent: ExtrudeExtent;
  distance: number;
  operation: ExtrudeOperation;
  /** Face choisie dans la vue 3D (profil d'esquisse ou face d'un modèle), si elle l'est. */
  face?: { kind: 'sketch' | 'mesh'; modelName: string | null; origin: Vec3; normal: Vec3 } | null;
}

interface ExtrudePanelProps {
  /** Nom de l'esquisse dont le profil est extrudé (la dernière du corps ciblé, ou l'esquisse flottante) ;
   *  `null` s'il n'y en a aucune. */
  sketchName: string | null;
  onConfirm: (params: ExtrudeParams) => void;
  onCancel: () => void;
}

interface Option<T extends string> { value: T; label: string }

const START_OPTIONS: Option<ExtrudeStart>[] = [
  { value: 'profile', label: 'Plan du contour' },
  { value: 'offset', label: 'Décalage' },
];
const DIRECTION_OPTIONS: Option<ExtrudeDirection>[] = [
  { value: 'one', label: 'Un côté' },
  { value: 'symmetric', label: 'Symétrique' },
];
const OPERATION_OPTIONS: Option<ExtrudeOperation>[] = [
  { value: 'new-body', label: 'Nouveau corps' },
  { value: 'join', label: 'Joindre' },
  { value: 'cut', label: 'Couper' },
  { value: 'intersect', label: 'Intersecter' },
];

interface DropdownProps<T extends string> {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: Option<T>[];
  tip: string;
}

/** Liste déroulante aux couleurs d'Apex (Radix Select / shadcn), avec son tooltip. */
function Dropdown<T extends string>({ label, value, onChange, options, tip }: DropdownProps<T>) {
  return (
    <CustomTooltip content={label} description={tip}>
      <Select value={value} onValueChange={(v) => onChange(v as T)}>
        <SelectTrigger className={styles.select} aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        {/* z-index > panneaux (1000/1001) : le menu est porté au <body>. */}
        <SelectContent className={styles.selectContent} style={{ zIndex: 3000 }}>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value} className={styles.selectItem}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </CustomTooltip>
  );
}

export const ExtrudePanel: React.FC<ExtrudePanelProps> = ({ sketchName, onConfirm, onCancel }) => {
  const [startFrom, setStartFrom] = useState<ExtrudeStart>('profile');
  const [direction, setDirection] = useState<ExtrudeDirection>('one');
  const [distanceText, setDistanceText] = useState('0');
  const [operation, setOperation] = useState<ExtrudeOperation>('new-body');

  const distance = Number(distanceText.trim().replace(',', '.'));
  const distanceValid = distanceText.trim() !== '' && Number.isFinite(distance) && distance > 0;
  const hasSketch = sketchName !== null;
  // Face choisie dans la vue 3D (cf. Viewport3D, outil Extrusion en mode Face).
  const [face, setFace] = useState<ExtrudeParams['face']>(null);
  const distanceInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const onFace = (e: Event) => setFace((e as CustomEvent<ExtrudeParams['face']>).detail ?? null);
    // Flèche tirée dans la vue : la distance apparaît en direct dans le champ.
    const onDistance = (e: Event) => {
      const value = (e as CustomEvent<{ distance: number }>).detail?.distance;
      if (Number.isFinite(value)) setDistanceText(String(Number(value.toFixed(2))));
    };
    const onFocus = () => { distanceInputRef.current?.focus(); distanceInputRef.current?.select(); };
    window.addEventListener('apex-extrude-face', onFace);
    window.addEventListener('apex-extrude-distance', onDistance);
    window.addEventListener('apex-extrude-focus-distance', onFocus);
    return () => {
      window.removeEventListener('apex-extrude-face', onFace);
      window.removeEventListener('apex-extrude-distance', onDistance);
      window.removeEventListener('apex-extrude-focus-distance', onFocus);
    };
  }, []);
  // Distance saisie au clavier : la flèche et l'aperçu suivent.
  useEffect(() => {
    if (distanceValid) window.dispatchEvent(new CustomEvent('apex-extrude-set-distance', { detail: { distance } }));
  }, [distance, distanceValid]);
  const canConfirm = (hasSketch || face !== null) && distanceValid;

  const confirm = () => {
    if (!canConfirm) return;
    // Type (solide) et étendue (distance) ne se règlent plus : valeurs fixes.
    onConfirm({ bodyType: 'solid', startFrom, direction, extent: 'distance', distance, operation, face });
  };

  return (
    <motion.div
      className={styles.panel}
      data-apex-chrome-panel
      data-apex-tooltip="Tire le profil d'un plan surfacique, parallèlement ou non à sa normale pour générer un volume."
      initial={{ opacity: 0, x: 28 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 28 }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      onKeyDown={(e) => {
        // Les touches saisies ici n'atteignent pas les raccourcis globaux.
        e.stopPropagation();
        if (e.key === 'Enter') confirm();
        if (e.key === 'Escape') onCancel();
      }}
    >
      <div className={styles.header}>
        <ExtrudeIcon className={clsx('w-4 h-4', styles.headerIcon)} />
        <span>Extrusion</span>
      </div>

      <div className={styles.rows}>
        {!hasSketch && face === null && (
          // L'enveloppe du tooltip est l'élément de la grille : c'est elle qui doit occuper les deux
          // colonnes (sinon le bandeau n'en prend qu'une et décale toutes les lignes suivantes).
          <CustomTooltip
            content="Aucune face sélectionnée"
            description="Sélectionnez une face plane ou un profil d'esquisse dans la vue 3D : une flèche apparaît alors, à tirer pour régler la distance."
            wrapperStyle={{ gridColumn: '1 / -1' }}
          >
            <p
              style={{
                width: '100%', margin: 0, padding: '6px 10px', borderRadius: 10,
                background: 'rgba(255, 69, 58, 0.14)', color: '#ff7a70', fontSize: 12,
              }}
            >
              Sélectionnez une face (ou un profil d'esquisse) dans la vue 3D.
            </p>
          </CustomTooltip>
        )}

        <span className={styles.label}>Démarrer</span>
        <Dropdown<ExtrudeStart>
          label="Démarrer"
          value={startFrom}
          onChange={setStartFrom}
          options={START_OPTIONS}
          tip="Où l'extrusion démarre par rapport au plan de l'esquisse (le décalage arrive bientôt)."
        />

        <span className={styles.label}>Direction</span>
        <Dropdown<ExtrudeDirection>
          label="Direction"
          value={direction}
          onChange={setDirection}
          options={DIRECTION_OPTIONS}
          tip="Le sens de l'extrusion par rapport au plan de l'esquisse : d'un côté, ou de part et d'autre."
        />

        <span className={styles.label}>Distance</span>
        <CustomTooltip content="Distance" description="Longueur de l'extrusion, en millimètres (strictement positive).">
          <div className={clsx(styles.distance, { [styles.invalid]: !distanceValid })}>
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              spellCheck={false}
              value={distanceText}
              ref={(el) => {
                distanceInputRef.current = el;
                // À l'ouverture : champ actif, texte entièrement sélectionné (on tape par-dessus le 0).
                if (el && !el.dataset.focused) { el.dataset.focused = '1'; el.focus({ preventScroll: true }); el.select(); }
              }}
              onChange={(e) => setDistanceText(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              aria-label="Distance en millimètres"
            />
            <span>mm</span>
          </div>
        </CustomTooltip>

        <span className={styles.separator} />

        <span className={styles.label}>Opération</span>
        <Dropdown<ExtrudeOperation>
          label="Opération"
          value={operation}
          onChange={setOperation}
          options={OPERATION_OPTIONS}
          tip="Ce que l'extrusion fait au reste de la scène : nouveau corps, jonction, coupe ou intersection (seul le nouveau corps est disponible pour l'instant)."
        />
      </div>

      <div className={styles.footer}>
        <CustomTooltip
          content="Tire le profil d'un plan surfacique, parallèlement ou non à sa normale pour générer un volume."
          description="Tire le profil d'un plan surfacique, parallèlement ou non à sa normale pour générer un volume."
        >
          <span className={styles.info}><Info className="w-4 h-4" /></span>
        </CustomTooltip>
        <span className={styles.spacer} />
        <CustomTooltip
          content="OK"
          description={canConfirm ? "Valide l'extrusion et l'ajoute au corps." : 'Sélectionnez les contours et une distance valide pour valider.'}
        >
          <button type="button" className={styles.ok} disabled={!canConfirm} onClick={confirm}>OK</button>
        </CustomTooltip>
        <CustomTooltip content="Annuler" description="Ferme le panneau sans créer d'extrusion.">
          <button type="button" className={styles.cancel} onClick={onCancel}>Annuler</button>
        </CustomTooltip>
      </div>
    </motion.div>
  );
};
