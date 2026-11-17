import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import type * as BABYLON from 'babylonjs';
import { showError } from '@/utils/toast';
import { ApexSlider } from '../ApexSlider';
import { PracticalModelsGrid, fetchPracticalModelFile, prewarmPracticalModels } from '../PracticalModelsGrid';
import styles from './ViewportContextMenu.module.scss';
import { DEFAULT_BLUR_LEVEL } from './viewportConstants';

import { emitApex } from '@/events/apexEvents';
import { ARRANGE_ALL_TIP, ARRANGE_SELECTION_TIP, LOCK_TIP } from '@/utils/arrangeTooltips';
// Info-bulles de bas d'écran des éléments du menu contextuel (cf. CLAUDE.md : chaque élément porte
// son texte). Un élément dont la commande n'existe pas encore le dit dans sa description.
const showTooltip = (tip: { title: string; desc: string }) =>
  emitApex('apex-set-tooltip', tip);
const hideTooltip = () => emitApex('apex-reset-tooltip');
const menuTooltip = (tip: { title: string; desc: string }) => ({
  onMouseEnter: () => showTooltip(tip),
  onMouseLeave: hideTooltip,
});
const SELECT_ALL_TOOLTIP = { title: 'Tout sélectionner', desc: 'Sélectionne tous les modèles du plateau.' };
const DELETE_ALL_TOOLTIP = { title: 'Tout supprimer', desc: 'Supprime tous les modèles du plateau.' };
const SCALE_TOOLTIP = {
  title: 'Échelle',
  desc: "Unité dans laquelle le fichier de ce modèle a été dessiné. Un STL n'en porte pas : s'il a été dessiné en pouces, il apparaît 25,4 fois trop petit.",
};
// Même courbe que le reste de l'application (cf. utils/easing.ts), au format attendu par Framer Motion.
const UNIT_PILL_EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];
const SCALE_INCH_TOOLTIP = { title: 'Pouces', desc: 'Lit le modèle en pouces : il est agrandi 25,4 fois, autour de son centre, et reste posé sur le plateau.' };
const SCALE_MM_TOOLTIP = { title: 'Millimètres', desc: 'Lit le modèle en millimètres (unité par défaut) : annule le passage en pouces.' };
// Outils pas encore disponibles : grisés et inactifs, seule l'info-bulle « Bientôt disponible ».
const SOON_TOOLTIP = { title: 'Bientôt disponible', desc: 'Bientôt disponible' };

// Menu contextuel par espace. Préparation a son propre menu (JSX dédié, dans le rendu) ; les autres
// espaces listent ici des idées de fonctions, non raccordées : elles sont grisées et renvoient
// « Bientôt disponible ». `plateBlur` : le réglage de flou sous le plateau y a sa place.
export type ContextMenuSpace = 'home' | 'preparation' | 'preview' | 'modeling' | 'dev';
const SPACE_MENU_ITEMS: Record<Exclude<ContextMenuSpace, 'preparation'>, { labels: string[]; plateBlur: boolean }> = {
  home: {
    plateBlur: false,
    labels: [
      'Nouveau projet', 'Ouvrir un projet récent', 'Ouvrir un G-code', 'Modèles d\'exemple',
      'Tutoriels de démarrage', 'Épingler un projet', 'Historique des projets', 'Ouvrir le dossier de travail',
      'Vérifier les mises à jour', 'Signaler un problème',
    ],
  },
  preview: {
    plateBlur: true,
    labels: [
      'Lecture / pause', 'Pas à pas précédent', 'Pas à pas suivant', 'Isoler la couche courante',
      'Masquer les déplacements à vide', 'Mesurer une distance', 'Coloration par vitesse',
      'Exporter une capture d\'écran', 'Afficher les temps d\'impression', 'Revenir au début du tracé',
    ],
  },
  modeling: {
    plateBlur: true,
    labels: [
      'Ajouter une sphère', 'Ajouter un cylindre', 'Ajouter un cône', 'Ajouter un tore',
      'Esquisse sur le plateau', 'Extruder la sélection', 'Symétrie', 'Union booléenne',
      'Soustraction booléenne', 'Congé / chanfrein',
    ],
  },
  dev: {
    plateBlur: false,
    labels: [
      'Afficher les logs de la console', 'Afficher les FPS', 'Inspecter la scène Babylon', 'Vider le cache des modèles',
      'Exporter l\'état de la scène', 'Afficher les normales', 'Afficher les collisions', 'Mesurer le rendu',
      'Simuler une erreur', 'Réinitialiser les préférences',
    ],
  },
};
const PRIMITIVE_TOOLTIP = { title: 'Ajouter une primitive', desc: 'Ajoute une forme simple, à dessiner directement sur le plateau.' };
const BOX_TOOLTIP = { title: 'Boîte', desc: 'Dessinez un pavé sur le plateau, puis donnez-lui sa hauteur.' };
const PYRAMID_TOOLTIP = { title: 'Pyramide 4 côtés', desc: 'Dessinez une base sur le plateau, puis donnez-lui sa hauteur : la pyramide se pose sur le plateau.' };
const MODELS_TOOLTIP = { title: 'Ajouter des modèles pratiques', desc: 'Ouvre une sélection de modèles de test à poser sur le plateau.' };

const BLUR_TOOLTIP = {
  title: 'Niveau de flou sous le plateau',
  desc: "Intensité du flou de la capture sous le plateau. Double-cliquez sur le curseur pour revenir à la valeur par défaut.",
};

type ContextMenuPoint = { x: number; y: number };
type ContextModel = { name: string; unit: 'mm' | 'in' };

interface ViewportContextMenuProps {
  contextMenu: ContextMenuPoint | null;
  setContextMenu: (point: ContextMenuPoint | null) => void;
  contextModel: ContextModel | null;
  setContextModel: (model: ContextModel | null) => void;
  contextSpace: ContextMenuSpace;
  modelsRef: React.MutableRefObject<Set<BABYLON.AbstractMesh>>;
  suppressNextBackdropContextMenuRef: React.MutableRefObject<boolean>;
}

/** Échelle du modèle sous le clic : le fond bleu glisse d'une option à l'autre (layoutId). */
const UnitRow: React.FC<{ contextModel: ContextModel; setContextModel: (model: ContextModel | null) => void }> = ({ contextModel, setContextModel }) => (
  <>
              <div className={`${styles.item} ${styles.static}`} {...menuTooltip(SCALE_TOOLTIP)}>
                <span style={{ fontWeight: 500 }}>Échelle</span>
                {/* Le fond bleu glisse d'une option à l'autre (layoutId) : la bascule suit la courbe de l'app. */}
                <span style={{ display: 'flex', gap: 2, padding: 3, borderRadius: 9, background: 'rgba(255,255,255,0.08)' }}>
                  {([['in', 'Pouces'], ['mm', 'Millimètres']] as const).map(([unit, label]) => {
                    const active = contextModel.unit === unit;
                    return (
                      <span
                        key={unit}
                        onClick={() => {
                          if (active) return;
                          emitApex('apex-set-model-unit', { name: contextModel.name, unit });
                          setContextModel({ ...contextModel, unit });
                        }}
                        style={{
                          position: 'relative', padding: '5px 12px', borderRadius: 7, fontSize: 10.7, cursor: 'pointer',
                          textAlign: 'center', userSelect: 'none', whiteSpace: 'nowrap',
                          color: active ? '#f59e0b' : 'rgba(255,255,255,0.8)',
                        }}
                        {...menuTooltip(unit === 'in' ? SCALE_INCH_TOOLTIP : SCALE_MM_TOOLTIP)}
                      >
                        {active && (
                          <motion.span
                            layoutId="apex-unit-pill"
                            transition={{ duration: 0.24, ease: UNIT_PILL_EASE }}
                            style={{ position: 'absolute', inset: 0, borderRadius: 7, background: 'rgba(245,158,11,0.22)' }}
                          />
                        )}
                        <span style={{ position: 'relative' }}>{label}</span>
                      </span>
                    );
                  })}
                </span>
              </div>
              <div className={styles.separator} />
  </>
);

/** Entrée « Ajouter une primitive » : sous-menu ouvert au survol, porté dans le body (hors du backdrop-filter du menu). */
const PrimitiveItem: React.FC<{ runAction: (fn: () => void) => void }> = ({ runAction }) => {
  const [primitiveSubmenuOpen, setPrimitiveSubmenuOpen] = useState(false);
  const primitiveItemRef = useRef<HTMLDivElement>(null);
  const primitiveHoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openPrimitiveSubmenu = () => {
    if (primitiveHoverTimeout.current) clearTimeout(primitiveHoverTimeout.current);
    setPrimitiveSubmenuOpen(true);
  };
  const closePrimitiveSubmenuDelayed = () => {
    if (primitiveHoverTimeout.current) clearTimeout(primitiveHoverTimeout.current);
    primitiveHoverTimeout.current = setTimeout(() => setPrimitiveSubmenuOpen(false), 120);
  };
  return (
            <div
              ref={primitiveItemRef}
              className={styles.item}
              onMouseEnter={() => { openPrimitiveSubmenu(); showTooltip(PRIMITIVE_TOOLTIP); }}
              onMouseLeave={() => { closePrimitiveSubmenuDelayed(); hideTooltip(); }}
            >
              <span>Ajouter une primitive</span><span className={styles.arrow}>›</span>

              {primitiveSubmenuOpen && primitiveItemRef.current && createPortal(
                <div
                  onMouseEnter={openPrimitiveSubmenu}
                  onMouseLeave={closePrimitiveSubmenuDelayed}
                  style={{
                    position: 'fixed',
                    top: primitiveItemRef.current.getBoundingClientRect().top - 6,
                    left: primitiveItemRef.current.getBoundingClientRect().right,
                    zIndex: 10001,
                    // Marge d'écartement visuelle (8px) portée par un padding plutôt qu'un
                    // offset de `left`, pour que la zone de survol reste continue entre
                    // l'entrée du menu et le sous-menu — sinon le hover se perd dans l'écart.
                    paddingLeft: 8,
                  }}
                >
                  <div
                    className={styles.submenu}
                  >
                    <div
                      className={styles.item}
                      onClick={() => runAction(() => emitApex('apex-primitive-box-start'))} {...menuTooltip(BOX_TOOLTIP)}
                    >
                      Boîte
                    </div>
                    <div
                      className={styles.item}
                      onClick={() => runAction(() => emitApex('apex-primitive-pyramid-start'))} {...menuTooltip(PYRAMID_TOOLTIP)}
                    >
                      Pyramide 4 côtés
                    </div>
                  </div>
                </div>,
                document.body,
              )}
            </div>
  );
};

/** Entrée « Ajouter des modèles pratiques » : même fonctionnement (survol, portail dans le body). */
const ModelsItem: React.FC<{
  modelsRef: React.MutableRefObject<Set<BABYLON.AbstractMesh>>;
  onPicked: () => void;
}> = ({ modelsRef, onPicked }) => {
  const [modelsSubmenuOpen, setModelsSubmenuOpen] = useState(false);
  const modelsItemRef = useRef<HTMLDivElement>(null);
  const pendingTestNames = useRef(new Set<string>());
  const modelsHoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openModelsSubmenu = () => {
    if (modelsHoverTimeout.current) clearTimeout(modelsHoverTimeout.current);
    setModelsSubmenuOpen(true);
  };
  const closeModelsSubmenuDelayed = () => {
    if (modelsHoverTimeout.current) clearTimeout(modelsHoverTimeout.current);
    modelsHoverTimeout.current = setTimeout(() => setModelsSubmenuOpen(false), 120);
  };
  return (
            <div
              ref={modelsItemRef}
              className={styles.item}
              onMouseEnter={() => { openModelsSubmenu(); showTooltip(MODELS_TOOLTIP); }}
              onMouseLeave={() => { closeModelsSubmenuDelayed(); hideTooltip(); }}
            >
              <span>Ajouter des modèles pratiques</span><span className={styles.arrow}>›</span>

              {modelsSubmenuOpen && modelsItemRef.current && createPortal(
                <div
                  onMouseEnter={openModelsSubmenu}
                  onMouseLeave={closeModelsSubmenuDelayed}
                  style={{
                    position: 'fixed',
                    top: Math.max(8, Math.min(modelsItemRef.current.getBoundingClientRect().top - 6, window.innerHeight - 340)),
                    left: modelsItemRef.current.getBoundingClientRect().right,
                    zIndex: 10001,
                    paddingLeft: 8,
                  }}
                >
                  <div
                    className={styles.submenu}
                  >
                    <PracticalModelsGrid
                      onHover={(model) => (model
                        ? showTooltip({ title: model.label, desc: 'Ajoute ce modèle de test sur le plateau.' })
                        : showTooltip(MODELS_TOOLTIP))}
                      onPick={(model) => {
                        // Le modèle prend le nom « test_x », x = plus petit numéro libre (plateau + imports en cours).
                        const taken = new Set([...Array.from(modelsRef.current).map((m) => m.name), ...pendingTestNames.current]);
                        let n = 1;
                        while (taken.has(`test_${n}`)) n++;
                        const testName = `test_${n}`;
                        pendingTestNames.current.add(testName);
                        window.addEventListener('apex-import-model-settled', () => pendingTestNames.current.delete(testName), { once: true });
                        void fetchPracticalModelFile(model, testName)
                          .then((file) => emitApex('apex-import-model', file))
                          .catch(() => showError(`Échec du chargement du modèle : ${model.fileName}.`));
                        onPicked();
                        hideTooltip();
                      }}
                    />
                  </div>
                </div>,
                document.body,
              )}
            </div>
  );
};

/** Réglage du flou sous le plateau. */
const BlurSlider: React.FC<{ blurLevel: number; setBlurLevel: (level: number) => void }> = ({ blurLevel, setBlurLevel }) => (
            <div style={{ padding: '8px 14px 4px' }}>
              <div className={styles.label}>Niveau de flou sous le plateau</div>
              <ApexSlider
                tooltip={BLUR_TOOLTIP}
                value={blurLevel}
                onChange={(level) => {
                  setBlurLevel(level);
                  emitApex('apex-set-blur-level', { level });
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

export const ViewportContextMenu: React.FC<ViewportContextMenuProps> = ({
  contextMenu, setContextMenu, contextModel, setContextModel, contextSpace, modelsRef, suppressNextBackdropContextMenuRef,
}) => {
  const [blurLevel, setBlurLevel] = useState(DEFAULT_BLUR_LEVEL);
  const runAction = (fn: () => void) => {
    fn();
    setContextMenu(null);
  };

  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);


  React.useLayoutEffect(() => {
    if (!contextMenu) {
      setMenuPos(null);
      return;
    }
    // Les miniatures des modèles pratiques se dessinent déjà pendant que le menu s'ouvre.
    prewarmPracticalModels();
    setMenuPos(contextMenu);
  }, [contextMenu]);

  React.useLayoutEffect(() => {
    if (!contextMenu || !menuRef.current) return;
    const { width, height } = menuRef.current.getBoundingClientRect();
    const margin = 8;

    const clamp = (x: number, y: number) => ({
      x: Math.min(Math.max(x, margin), window.innerWidth - width - margin),
      y: Math.min(Math.max(y, margin), window.innerHeight - height - margin),
    });

    // 4 candidats façon menu contextuel classique : sous/au-dessus, à droite/à gauche du clic.
    const candidates = [
      clamp(contextMenu.x, contextMenu.y),
      clamp(contextMenu.x, contextMenu.y - height),
      clamp(contextMenu.x - width, contextMenu.y),
      clamp(contextMenu.x - width, contextMenu.y - height),
    ];

    const chromeRects = Array.from(document.querySelectorAll('[data-apex-chrome-panel]')).map((el) =>
      el.getBoundingClientRect()
    );

    const overlapArea = (pos: { x: number; y: number }) => {
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

  if (!contextMenu) return null;
  return createPortal(
        <>
          {/* Apparition du menu : fondu + léger glissement, puis les entrées en cascade. */}
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 9999 }}
            onClick={() => setContextMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              if (suppressNextBackdropContextMenuRef.current) {
                // Écho du contextmenu natif du clic qui vient d'ouvrir ce menu : on l'avale une
                // fois plutôt que de refermer ce qu'on vient d'ouvrir.
                suppressNextBackdropContextMenuRef.current = false;
                return;
              }
              // Nouveau clic droit pendant que le menu est ouvert : il se referme et se rouvre
              // directement au nouveau point (le rideau capte ce clic, Babylon ne le voit pas).
              setContextMenu({ x: e.clientX, y: e.clientY });
            }}
          />
          <div
            key={`${contextMenu.x}_${contextMenu.y}`}
            ref={menuRef}
            className={styles.menu}
            style={{
              position: 'fixed', top: (menuPos ?? contextMenu).y, left: (menuPos ?? contextMenu).x, zIndex: 10000,
              visibility: menuPos ? 'visible' : 'hidden',
                          }}
          >
            {contextSpace === 'preparation' && contextModel && (<>
              <UnitRow contextModel={contextModel} setContextModel={setContextModel} />
            </>)}
            {contextSpace === 'preparation' && (<>
            <div className={styles.item} onClick={() => runAction(() => emitApex('apex-select-all-models'))} {...menuTooltip(SELECT_ALL_TOOLTIP)}>Tout sélectionner</div>
            <div className={styles.item} onClick={() => runAction(() => emitApex('apex-delete-all-models'))} {...menuTooltip(DELETE_ALL_TOOLTIP)}>Tout Supprimer</div>
            <div className={styles.item} onClick={() => runAction(() => emitApex('apex-arrange-models'))} {...menuTooltip(ARRANGE_ALL_TIP)}>Disposer automatiquement</div>
            <div className={styles.item} onClick={() => runAction(() => emitApex('apex-arrange-selection'))} {...menuTooltip(ARRANGE_SELECTION_TIP)}>Disposer la sélection</div>
            <div className={styles.item} onClick={() => runAction(() => emitApex('apex-toggle-lock-models'))} {...menuTooltip(LOCK_TIP)}>Verrouiller / déverrouiller la sélection</div>
            <div className={styles.separator} />
            <PrimitiveItem runAction={runAction} />
            <ModelsItem modelsRef={modelsRef} onPicked={() => setContextMenu(null)} />
            <div className={styles.separator} />
            </>)}
            {contextSpace !== 'preparation' && (<>
              {SPACE_MENU_ITEMS[contextSpace].labels.map((label) => (
                <div key={label} className={`${styles.item} ${styles.itemInert}`} {...menuTooltip(SOON_TOOLTIP)}>
                  {label}
                </div>
              ))}
              <div className={styles.separator} />
            </>)}
            {(contextSpace === 'preparation' || SPACE_MENU_ITEMS[contextSpace].plateBlur) && (
            <BlurSlider blurLevel={blurLevel} setBlurLevel={setBlurLevel} />
            )}
          </div>
        </>,
        document.body,
  );
};
