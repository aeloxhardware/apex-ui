import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { usePortalRoot } from '@/components/GpuWarningFrame';
import { ApexButton, ApexCheckbox, ApexNumberField, ApexSelect, ApexSlider, type ApexSelectOption } from './apex-ui';
import { bottomTip } from './edit-node/bottomTooltip';
import { emitApex, onApex } from '@/events/apexEvents';
import type { CutPlaneParams, PartPlacement } from '@/utils/cutPlane';
import {
  CUT_FLIP_TIP,
  CUT_HEIGHT_TIP,
  CUT_LOWER_TIP,
  CUT_NO_TARGET_TIP,
  CUT_PANEL_TIP,
  CUT_PERFORM_TIP,
  CUT_PLACEMENT_TIPS,
  CUT_ROTATION_TIP,
  CUT_UPPER_TIP,
  type CutTip,
} from '@/utils/cutTooltips';
import styles from './CutBox.module.scss';

/**
 * Panneau de l'outil Couper (C), sous la barre d'outils comme la boîte Déplacer / Pivoter / Échelle. Il ne touche pas à la
 * scène : le viewport lui annonce le modèle visé (`apex-cut-target`), il renvoie le plan (`apex-cut-plane`, aperçu) et la
 * coupe (`apex-cut-perform`). Logique de coupe : components/viewport/viewportCut.ts.
 */
interface PartOptions {
  keep: boolean;
  placement: PartPlacement;
}

interface Target {
  name: string | null;
  bottom: number;
  top: number;
}

const PLACEMENTS: readonly ApexSelectOption<PartPlacement>[] = [
  { value: 'keep', label: 'Telle quelle', tip: CUT_PLACEMENT_TIPS.keep },
  { value: 'on-cut', label: 'Sur la coupe', tip: CUT_PLACEMENT_TIPS['on-cut'] },
  { value: 'flip', label: 'Retournée', tip: CUT_PLACEMENT_TIPS.flip },
];

const ROTATIONS: { key: 'a' | 'b' | 'c'; letter: string; color: string }[] = [
  { key: 'a', letter: 'A', color: '#ff5a5a' },
  { key: 'b', letter: 'B', color: '#4fe08a' },
  { key: 'c', letter: 'C', color: '#5a9bff' },
];

/** Choix des parties retenus d'une ouverture de l'outil à l'autre (pas d'un lancement de l'application à l'autre). */
let rememberedParts: { upper: PartOptions; lower: PartOptions } = {
  upper: { keep: true, placement: 'keep' },
  lower: { keep: true, placement: 'keep' },
};

const round = (v: number) => Math.round(v * 100) / 100;
/** Angle ramené dans ]-180, 180]. */
const wrapAngle = (deg: number) => round(((((deg + 180) % 360) + 360) % 360) - 180) || 0;

const tip = (t: CutTip) => bottomTip(t.title, t.desc);

const PartRow: React.FC<{ label: string; tipText: CutTip; value: PartOptions; onChange: (v: PartOptions) => void }> = ({
  label,
  tipText,
  value,
  onChange,
}) => (
  <div className={styles.part} {...tip(tipText)}>
    <span className={styles.label}>{label}</span>
    <label className={styles.check}>
      <ApexCheckbox checked={value.keep} onChange={(e) => onChange({ ...value, keep: e.target.checked })} />
      Garder
    </label>
    <ApexSelect
      value={value.placement}
      options={PLACEMENTS}
      disabled={!value.keep}
      ariaLabel={`Mise en place : ${label}`}
      onChange={(placement) => onChange({ ...value, placement })}
    />
  </div>
);

/** Plan et modèle visé : le plan revient au milieu du modèle quand la cible change, et suit le gizmo de la scène. */
function useCutPlane() {
  const [target, setTarget] = useState<Target>({ name: null, bottom: 0, top: 0 });
  const [plane, setPlane] = useState<CutPlaneParams>({ height: 0, x: 0, y: 0, a: 0, b: 0, c: 0 });
  const lastName = useRef<string | null>(null);

  useEffect(() => {
    const offTarget = onApex('apex-cut-target', (t) => {
      setTarget(t);
      if (t.name !== null && t.name !== lastName.current) {
        setPlane((p) => ({ ...p, height: round((t.bottom + t.top) / 2), x: 0, y: 0 }));
      }
      lastName.current = t.name;
    });
    const offDragged = onApex('apex-cut-plane-dragged', (p) =>
      setPlane({ height: round(p.height), x: round(p.x), y: round(p.y), a: round(p.a), b: round(p.b), c: p.c }),
    );
    emitApex('apex-cut-target-request');
    return () => {
      offTarget();
      offDragged();
    };
  }, []);

  useEffect(() => emitApex('apex-cut-plane', plane), [plane]);
  return { target, plane, setPlane };
}

/** Recale la boîte sur le bas de la barre d'outils à chaque image (même placement que TransformBox). */
function useAnchoredBox(anchorRef: React.RefObject<HTMLElement | null>, portalRoot: HTMLElement) {
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let frame = 0;
    const place = () => {
      const box = boxRef.current;
      const bar = anchorRef.current?.getBoundingClientRect();
      if (box && bar) {
        const root = portalRoot.getBoundingClientRect();
        box.style.top = `${bar.bottom - root.top + BOX_GAP}px`;
        box.style.left = `${bar.left + bar.width / 2 - root.left}px`;
      }
      frame = requestAnimationFrame(place);
    };
    place();
    return () => cancelAnimationFrame(frame);
  }, [anchorRef, portalRoot]);
  return boxRef;
}

const BOX_GAP = 8;

const CutBox: React.FC<{ anchorRef: React.RefObject<HTMLElement | null> }> = ({ anchorRef }) => {
  const portalRoot = usePortalRoot();
  const boxRef = useAnchoredBox(anchorRef, portalRoot);
  const { target, plane, setPlane } = useCutPlane();
  const [parts, setParts] = useState(rememberedParts);
  const hasModel = target.name !== null;
  const span = Math.max(target.top - target.bottom, 0.01);

  useEffect(() => {
    rememberedParts = parts;
  }, [parts]);

  const perform = () => emitApex('apex-cut-perform', { plane, upper: parts.upper, lower: parts.lower });

  return createPortal(
    <div ref={boxRef} className={clsx(styles.box, !hasModel && styles.disabled)} {...tip(hasModel ? CUT_PANEL_TIP : CUT_NO_TARGET_TIP)}>
      <div className={styles.line} {...tip(CUT_HEIGHT_TIP)}>
        <ApexSlider
          className={styles.slider}
          label="Hauteur"
          value={plane.height}
          min={round(target.bottom)}
          max={round(target.bottom + span)}
          step={0.1}
          defaultValue={round((target.bottom + target.top) / 2)}
          format={(v) => `${v.toFixed(1)} mm`}
          ariaLabel="Hauteur de coupe"
          onChange={(height) => setPlane((p) => ({ ...p, height: round(height) }))}
        />
        <ApexNumberField
          className={styles.height}
          value={plane.height}
          step={0.1}
          suffix="mm"
          ariaLabel="Hauteur de coupe (mm)"
          onChange={(v) => v !== null && setPlane((p) => ({ ...p, height: v }))}
        />
      </div>
      <div className={styles.line}>
        <div className={styles.rotations} {...tip(CUT_ROTATION_TIP)}>
          {ROTATIONS.map(({ key, letter, color }) => (
            <div key={key} className={styles.cell}>
              <span className={styles.letter} style={{ color }}>
                {letter}
              </span>
              <ApexNumberField
                value={plane[key]}
                step={5}
                suffix="°"
                ariaLabel={`Inclinaison du plan ${letter}`}
                onChange={(v) => v !== null && setPlane((p) => ({ ...p, [key]: wrapAngle(v) }))}
              />
            </div>
          ))}
        </div>
        <ApexButton size="sm" variant="field" onClick={() => setPlane((p) => ({ ...p, a: wrapAngle(p.a + 180) }))} {...tip(CUT_FLIP_TIP)}>
          Retourner
        </ApexButton>
      </div>
      <PartRow label="Partie haute" tipText={CUT_UPPER_TIP} value={parts.upper} onChange={(upper) => setParts((p) => ({ ...p, upper }))} />
      <PartRow label="Partie basse" tipText={CUT_LOWER_TIP} value={parts.lower} onChange={(lower) => setParts((p) => ({ ...p, lower }))} />
      <ApexButton
        className={styles.perform}
        variant="accent"
        disabled={!hasModel || (!parts.upper.keep && !parts.lower.keep)}
        onClick={perform}
        {...tip(CUT_PERFORM_TIP)}
      >
        Couper
      </ApexButton>
    </div>,
    portalRoot,
  );
};

export default CutBox;
