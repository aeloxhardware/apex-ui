import React, { useEffect, useRef, useState, useLayoutEffect } from 'react';
import type * as BABYLON from 'babylonjs';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { ApexSlider } from '../ApexSlider';
import { PracticalModelsGrid, fetchPracticalModelFile, prewarmPracticalModels } from '../PracticalModelsGrid';
import { showError } from '@/utils/toast';
import { DEFAULT_BLUR_LEVEL } from './constants';
import {
  BLUR_TOOLTIP, BOX_TOOLTIP, DELETE_ALL_TOOLTIP, MODELS_TOOLTIP, ORGANIZE_TOOLTIP, PRIMITIVE_TOOLTIP,
  PYRAMID_TOOLTIP, SCALE_INCH_TOOLTIP, SCALE_MM_TOOLTIP, SCALE_TOOLTIP, SELECT_ALL_TOOLTIP, SOON_TOOLTIP,
  SPACE_MENU_ITEMS, UNIT_PILL_EASE, hideTooltip, menuTooltip, showTooltip, type ContextMenuSpace,
} from './menuTexts';

interface Point { x: number; y: number }
export interface ContextModel { name: string; unit: 'mm' | 'in' }

export interface ViewportContextMenuProps {
  /** Point du clic droit (coordonnées écran). */
  position: Point;
  space: ContextMenuSpace;
  /** Modèle sous le clic (null = clic dans le vide) et son unité courante. */
  model: ContextModel | null;
  blurLevel: number;
  modelsRef: React.MutableRefObject<Set<BABYLON.AbstractMesh>>;
  /** Noms « test_x » des modèles pratiques en cours d'import : survivent à la fermeture du menu. */
  pendingTestNames: React.MutableRefObject<Set<string>>;
  /** Le clic droit qui ouvre le menu déclenche ensuite, sur ce même clic, l'événement DOM natif
   * `contextmenu` : au moment où celui-ci se déclenche, le rideau de fermeture (qui couvre tout
   * l'écran) est déjà monté sous le curseur et en reçoit la cible — sans ce garde-fou, son propre
   * `onContextMenu` referme le menu qui vient tout juste de s'ouvrir. On l'arme juste avant
   * d'ouvrir et on l'ignore une seule fois, côté rideau. */
  suppressNextBackdropContextMenuRef: React.MutableRefObject<boolean>;
  onClose(): void;
  /** Nouveau clic droit pendant que le menu est ouvert : il se rouvre au nouveau point. */
  onReopen(position: Point): void;
  onModelChange(model: ContextModel): void;
  onBlurChange(level: number): void;
}

const menuItemStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '8px 14px', fontSize: 13, color: 'rgba(255,255,255,0.9)',
  cursor: 'pointer', whiteSpace: 'nowrap', borderRadius: 8,
};
const disabledItemStyle: React.CSSProperties = { ...menuItemStyle, color: 'rgba(255,255,255,0.35)', cursor: 'default' };

/** Verre dépoli commun au menu et à ses sous-menus. */
const glassPanel: React.CSSProperties = {
  padding: 6, borderRadius: 14,
  background: 'rgba(20,22,30,0.55)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
  boxShadow: '0 12px 40px 0 rgba(0,0,0,0.45), 0 4px 16px 0 rgba(0,0,0,0.35)',
  border: 'none',
};

const Separator = () => <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '6px 4px' }} />;

/** Apparition du menu : fondu + léger glissement, puis les entrées en cascade. */
const MENU_ANIMATION_CSS = `
  @keyframes apex-ctx-menu-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
  @keyframes apex-ctx-item-in { from { opacity: 0; transform: translateX(-3px); } to { opacity: 1; transform: none; } }
  .apex-ctx-menu { animation: apex-ctx-menu-in 100ms ease-out both; }
  .apex-ctx-menu > * { animation: apex-ctx-item-in 120ms ease-out both; }
  .apex-ctx-menu > *:nth-child(1) { animation-delay: 30ms; }
  .apex-ctx-menu > *:nth-child(2) { animation-delay: 50ms; }
  .apex-ctx-menu > *:nth-child(3) { animation-delay: 70ms; }
  .apex-ctx-menu > *:nth-child(4) { animation-delay: 90ms; }
  .apex-ctx-menu > *:nth-child(5) { animation-delay: 110ms; }
  .apex-ctx-menu > *:nth-child(6) { animation-delay: 130ms; }
  .apex-ctx-menu > *:nth-child(7) { animation-delay: 150ms; }
  .apex-ctx-menu > *:nth-child(8) { animation-delay: 170ms; }
  .apex-ctx-menu > *:nth-child(9) { animation-delay: 190ms; }
  @media (prefers-reduced-motion: reduce) {
    .apex-ctx-menu, .apex-ctx-menu > * { animation: none; }
  }
`;

/**
 * Sous-menu ouvert au survol de son entrée, fermé dès qu'on quitte la zone (entrée + panneau), pas
 * au clic — comme un menu contextuel classique. Il est porté dans le body (portail) pour être hors du
 * backdrop-filter du menu, qui l'empêcherait de flouter son fond ; sa position suit son entrée.
 */
function useHoverSubmenu() {
  const [open, setOpen] = useState(false);
  const itemRef = useRef<HTMLDivElement>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => { if (timeout.current) clearTimeout(timeout.current); };
  useEffect(() => clear, []);
  return {
    open,
    itemRef,
    show: () => { clear(); setOpen(true); },
    hideSoon: () => { clear(); timeout.current = setTimeout(() => setOpen(false), 120); },
  };
}

type HoverSubmenu = ReturnType<typeof useHoverSubmenu>;

/**
 * Position du menu : 4 candidats façon menu contextuel classique (sous/au-dessus, à droite/à gauche du
 * clic), en gardant celui qui recouvre le moins les panneaux de l'interface. Masqué (`null`) jusqu'à la
 * première mesure.
 */
function useMenuPosition(position: Point) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<Point | null>(null);

  useLayoutEffect(() => {
    // Les miniatures des modèles pratiques se dessinent déjà pendant que le menu s'ouvre.
    prewarmPracticalModels();
    setMenuPos(position);
  }, [position]);

  useLayoutEffect(() => {
    if (!menuRef.current) return;
    const { width, height } = menuRef.current.getBoundingClientRect();
    const margin = 8;
    const clamp = (x: number, y: number) => ({
      x: Math.min(Math.max(x, margin), window.innerWidth - width - margin),
      y: Math.min(Math.max(y, margin), window.innerHeight - height - margin),
    });
    const candidates = [
      clamp(position.x, position.y),
      clamp(position.x, position.y - height),
      clamp(position.x - width, position.y),
      clamp(position.x - width, position.y - height),
    ];
    const chromeRects = Array.from(document.querySelectorAll('[data-apex-chrome-panel]')).map((el) =>
      el.getBoundingClientRect(),
    );
    const overlapArea = (pos: Point) => {
      const rect = { left: pos.x, top: pos.y, right: pos.x + width, bottom: pos.y + height };
      return chromeRects.reduce((total, r) => {
        const w = Math.max(0, Math.min(rect.right, r.right) - Math.max(rect.left, r.left));
        const h = Math.max(0, Math.min(rect.bottom, r.bottom) - Math.max(rect.top, r.top));
        return total + w * h;
      }, 0);
    };
    let best = candidates[0];
    let bestOverlap = overlapArea(best);
    for (let i = 1; i < candidates.length && bestOverlap > 0; i++) {
      const overlap = overlapArea(candidates[i]);
      if (overlap < bestOverlap) {
        best = candidates[i];
        bestOverlap = overlap;
      }
    }
    if (best.x !== menuPos?.x || best.y !== menuPos?.y) setMenuPos(best);
  });

  return { menuRef, menuPos };
}

/** Bascule pouces / millimètres du modèle sous le clic : le fond bleu glisse d'une option à l'autre (layoutId). */
function UnitSwitch({ model, onChange }: { model: ContextModel; onChange(model: ContextModel): void }) {
  return (
    <>
      <div style={{ ...menuItemStyle, cursor: 'default', gap: 18, padding: '10px 14px' }} {...menuTooltip(SCALE_TOOLTIP)}>
        <span style={{ fontWeight: 500 }}>Échelle</span>
        <span style={{ display: 'flex', gap: 2, padding: 3, borderRadius: 9, background: 'rgba(255,255,255,0.08)' }}>
          {([['in', 'Pouces'], ['mm', 'Millimètres']] as const).map(([unit, label]) => {
            const active = model.unit === unit;
            return (
              <span
                key={unit}
                onClick={() => {
                  if (active) return;
                  window.dispatchEvent(new CustomEvent('apex-set-model-unit', { detail: { name: model.name, unit } }));
                  onChange({ ...model, unit });
                }}
                style={{
                  position: 'relative', padding: '5px 12px', borderRadius: 7, fontSize: 12, cursor: 'pointer',
                  textAlign: 'center', userSelect: 'none', whiteSpace: 'nowrap',
                  color: active ? '#00f0ff' : 'rgba(255,255,255,0.8)',
                }}
                {...menuTooltip(unit === 'in' ? SCALE_INCH_TOOLTIP : SCALE_MM_TOOLTIP)}
              >
                {active && (
                  <motion.span
                    layoutId="apex-unit-pill"
                    transition={{ duration: 0.24, ease: UNIT_PILL_EASE }}
                    style={{ position: 'absolute', inset: 0, borderRadius: 7, background: 'rgba(0,240,255,0.22)' }}
                  />
                )}
                <span style={{ position: 'relative' }}>{label}</span>
              </span>
            );
          })}
        </span>
      </div>
      <Separator />
    </>
  );
}

/** Entrée de menu portant un sous-menu flottant à sa droite. */
function SubmenuItem(props: {
  label: string;
  tooltip: { title: string; desc: string };
  submenu: HoverSubmenu;
  /** Ordonnée du panneau, à partir de celle de l'entrée. */
  top?: (itemTop: number) => number;
  panelStyle?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const { label, tooltip, submenu, top, panelStyle, children } = props;
  const rect = submenu.open && submenu.itemRef.current ? submenu.itemRef.current.getBoundingClientRect() : null;
  return (
    <div
      ref={submenu.itemRef}
      style={{ ...menuItemStyle, position: 'relative' }}
      onMouseEnter={() => { submenu.show(); showTooltip(tooltip); }}
      onMouseLeave={() => { submenu.hideSoon(); hideTooltip(); }}
    >
      <span>{label}</span><span style={{ opacity: 0.6 }}>›</span>

      {rect && createPortal(
        <div
          onMouseEnter={submenu.show}
          onMouseLeave={submenu.hideSoon}
          style={{
            position: 'fixed',
            top: top ? top(rect.top) : rect.top - 6,
            left: rect.right,
            zIndex: 10001,
            // Marge d'écartement visuelle (8px) portée par un padding plutôt qu'un offset de `left`,
            // pour que la zone de survol reste continue entre l'entrée du menu et le sous-menu —
            // sinon le hover se perd dans l'écart.
            paddingLeft: 8,
          }}
        >
          <div style={{ ...glassPanel, ...panelStyle }}>{children}</div>
        </div>,
        document.body,
      )}
    </div>
  );
}

/** Menu de l'espace Préparation : sélection, primitives, modèles pratiques. */
function PreparationItems(props: Pick<ViewportContextMenuProps, 'modelsRef' | 'pendingTestNames' | 'onClose'>) {
  const { modelsRef, pendingTestNames, onClose } = props;
  const primitives = useHoverSubmenu();
  const models = useHoverSubmenu();
  const runAction = (fn: () => void) => { fn(); onClose(); };
  const dispatch = (name: string) => () => runAction(() => window.dispatchEvent(new CustomEvent(name)));

  // Le modèle prend le nom « test_x », x = plus petit numéro libre (plateau + imports en cours).
  const pickPracticalModel = (model: Parameters<typeof fetchPracticalModelFile>[0]) => {
    const taken = new Set([...Array.from(modelsRef.current).map((m) => m.name), ...pendingTestNames.current]);
    let n = 1;
    while (taken.has(`test_${n}`)) n++;
    const testName = `test_${n}`;
    pendingTestNames.current.add(testName);
    window.addEventListener('apex-import-model-settled', () => pendingTestNames.current.delete(testName), { once: true });
    void fetchPracticalModelFile(model, testName)
      .then((file) => window.dispatchEvent(new CustomEvent('apex-import-model', { detail: file })))
      .catch(() => showError(`Échec du chargement du modèle : ${model.fileName}.`));
    onClose();
    hideTooltip();
  };

  return (
    <>
      <div style={menuItemStyle} onClick={dispatch('apex-select-all-models')} {...menuTooltip(SELECT_ALL_TOOLTIP)}>Tout sélectionner</div>
      <div style={menuItemStyle} onClick={dispatch('apex-delete-all-models')} {...menuTooltip(DELETE_ALL_TOOLTIP)}>Tout Supprimer</div>
      <div style={disabledItemStyle} {...menuTooltip(ORGANIZE_TOOLTIP)}>Organiser</div>
      <Separator />
      <SubmenuItem label="Ajouter une primitive" tooltip={PRIMITIVE_TOOLTIP} submenu={primitives} panelStyle={{ minWidth: 160 }}>
        <div style={menuItemStyle} onClick={dispatch('apex-primitive-box-start')} {...menuTooltip(BOX_TOOLTIP)}>Boîte</div>
        <div style={menuItemStyle} onClick={dispatch('apex-primitive-pyramid-start')} {...menuTooltip(PYRAMID_TOOLTIP)}>Pyramide 4 côtés</div>
      </SubmenuItem>
      <SubmenuItem
        label="Ajouter des modèles pratiques"
        tooltip={MODELS_TOOLTIP}
        submenu={models}
        top={(itemTop) => Math.max(8, Math.min(itemTop - 6, window.innerHeight - 340))}
      >
        <PracticalModelsGrid
          onHover={(model) => (model
            ? showTooltip({ title: model.label, desc: 'Ajoute ce modèle de test sur le plateau.' })
            : showTooltip(MODELS_TOOLTIP))}
          onPick={pickPracticalModel}
        />
      </SubmenuItem>
      <Separator />
    </>
  );
}

/** Réglage du flou de la capture sous le plateau. */
function BlurSetting({ level, onChange }: { level: number; onChange(level: number): void }) {
  return (
    <div style={{ padding: '8px 14px 4px' }}>
      <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.9)', marginBottom: 6 }}>Niveau de flou sous le plateau</div>
      <ApexSlider
        tooltip={BLUR_TOOLTIP}
        value={level}
        onChange={(next) => {
          onChange(next);
          window.dispatchEvent(new CustomEvent('apex-set-blur-level', { detail: { level: next } }));
        }}
        min={0}
        max={120}
        step={1}
        defaultValue={DEFAULT_BLUR_LEVEL}
        format={(v) => `${Math.round(v)}`}
        ariaLabel="Niveau de flou sous le plateau"
      />
    </div>
  );
}

/** Rideau plein écran qui referme le menu au clic. */
function Backdrop(props: Pick<ViewportContextMenuProps, 'suppressNextBackdropContextMenuRef' | 'onClose' | 'onReopen'>) {
  const { suppressNextBackdropContextMenuRef, onClose, onReopen } = props;
  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9999 }}
      onClick={onClose}
      onContextMenu={(e) => {
        e.preventDefault();
        if (suppressNextBackdropContextMenuRef.current) {
          // Écho du contextmenu natif du clic qui vient d'ouvrir ce menu : on l'avale une fois plutôt
          // que de refermer ce qu'on vient d'ouvrir.
          suppressNextBackdropContextMenuRef.current = false;
          return;
        }
        // Nouveau clic droit pendant que le menu est ouvert : il se referme et se rouvre directement
        // au nouveau point (le rideau capte ce clic, Babylon ne le voit pas).
        onReopen({ x: e.clientX, y: e.clientY });
      }}
    />
  );
}

/**
 * Menu contextuel du viewport, porté dans le body : au-dessus de tous les panneaux (liquid glass
 * compris), hors de leurs contextes d'empilement et de leurs backdrop-filter. Préparation a son propre
 * menu ; les autres espaces listent des idées de fonctions, non raccordées (grisées, « Bientôt disponible »).
 */
export function ViewportContextMenu(props: ViewportContextMenuProps) {
  const { position, space, model, blurLevel } = props;
  const { menuRef, menuPos } = useMenuPosition(position);
  const preparation = space === 'preparation';
  const otherSpace = preparation ? null : SPACE_MENU_ITEMS[space];

  return createPortal(
    <>
      <style>{MENU_ANIMATION_CSS}</style>
      <Backdrop {...props} />
      <div
        key={`${position.x}_${position.y}`}
        ref={menuRef}
        className="apex-ctx-menu"
        style={{
          ...glassPanel,
          position: 'fixed', top: (menuPos ?? position).y, left: (menuPos ?? position).x, zIndex: 10000,
          visibility: menuPos ? 'visible' : 'hidden',
          minWidth: 220,
        }}
      >
        {preparation && model && <UnitSwitch model={model} onChange={props.onModelChange} />}
        {preparation && <PreparationItems {...props} />}
        {otherSpace && (
          <>
            {otherSpace.labels.map((label) => (
              <div key={label} style={disabledItemStyle} {...menuTooltip(SOON_TOOLTIP)}>{label}</div>
            ))}
            <Separator />
          </>
        )}
        {(preparation || otherSpace?.plateBlur) && <BlurSetting level={blurLevel} onChange={props.onBlurChange} />}
      </div>
    </>,
    document.body,
  );
}
