import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Box,
  ChevronRight,
  Circle,
  Eye,
  EyeOff,
  FlipHorizontal2,
  Minus,
  MousePointerSquareDashed,
  PenLine,
  RotateCw,
  Square,
  Trash2,
  Triangle,
  Waves,
} from 'lucide-react';
import styles from './ModelingSidebar.module.scss';
import { CustomTooltip } from './CustomTooltip';
import { ChamferIcon, FilletIcon } from './ModelingIcons';
import {
  LiquidGlassShadow,
  applyLiquidGlassShadow,
  applyGlassBlur,
  GLASS_BLUR_PX,
  PREVIEW_GLASS_BLUR_PX,
  type LiquidGlassShadowHandle,
} from './LiquidGlassMorph';
import { showError, showSuccess } from '@/utils/toast';
import {
  FEATURE_LABELS,
  SKETCH_ENTITY_LABELS,
  nextId,
  type Feature,
  type FeatureKind,
  type SelectionMode,
  type SketchEntityKind,
  type SketchPlane,
  type SketchPlaneRef,
} from '@/modeling/types';
import { modelingMorphStage, modelingPathAt, modelingMorphDuration } from '@/utils/spaceMorphGeometry';

/** Sous-maillage d'un modèle importé, tel que le diffuse `apex-mesh-selected`. */
interface SubMeshItem {
  id: string;
  name: string;
  color: string;
}

/** Un corps de la scène et les features paramétriques qui lui sont rattachées. */
interface ModelNode {
  id: string;
  name: string;
  children: SubMeshItem[];
  features: Feature[];
}

const TOOLS: {
  kind: FeatureKind;
  icon: React.ElementType;
  description: string;
}[] = [
  { kind: 'sketch', icon: PenLine, description: 'Créez des contours géométriques sur un plan ou une surface plane afin de définir la base d\'une conception tridimensionnelle.' },
  { kind: 'extrude', icon: Box, description: 'Extruder un profil d\'esquisse fermé le long de sa normale.' },
  { kind: 'revolve', icon: RotateCw, description: 'Faire tourner un profil autour d\'un axe.' },
  { kind: 'fillet', icon: FilletIcon, description: 'Arrondir les arêtes sélectionnées avec un rayon.' },
  { kind: 'chamfer', icon: ChamferIcon, description: 'Biseauter les arêtes sélectionnées.' },
  { kind: 'mirror', icon: FlipHorizontal2, description: 'Dupliquer le corps par symétrie autour d\'un point.' },
];

const SKETCH_ENTITIES: { kind: SketchEntityKind; icon: React.ElementType }[] = [
  { kind: 'line', icon: Minus },
  { kind: 'rectangle', icon: Square },
  { kind: 'circle', icon: Circle },
  { kind: 'triangle', icon: Triangle },
  { kind: 'curve', icon: Waves },
];

const SELECTION_MODES: { mode: SelectionMode; label: string; enabled: boolean }[] = [
  { mode: 'body', label: 'Corps', enabled: true },
  { mode: 'face', label: 'Face', enabled: true },
  { mode: 'edge', label: 'Arête', enabled: false },
  { mode: 'vertex', label: 'Sommet', enabled: false },
];

const FEATURE_ICONS: Record<FeatureKind, React.ElementType> = {
  sketch: PenLine,
  extrude: Box,
  revolve: RotateCw,
  fillet: FilletIcon,
  chamfer: ChamferIcon,
  mirror: FlipHorizontal2,
};

// Fraction du morph ('enter' : t croissant de 0 à 1) au-delà de laquelle la silhouette est assez
// proche de sa forme normale pour que le contenu (header, Sélection, Corps) commence à apparaître,
// un groupe après l'autre (cf. contentVariants / CONTENT_STAGGER_MS). En dessous, le contenu reste
// (cf. contentRevealed) invisible plutôt que de montrer un fragment illisible d'un texte/bouton bien
// plus grand que la silhouette qui le découpe. `1` (pas moins) : le contenu ne doit apparaître
// qu'UNE FOIS la déformation entièrement terminée, jamais pendant qu'elle est encore en cours (même
// proche de la fin, la silhouette peut encore être trop étroite/basse pour l'accueillir proprement).
const CONTENT_REVEAL_THRESHOLD = 1;
const CONTENT_STAGGER_MS = 0.09;

// Cascade dans les deux sens, toujours du haut vers le bas (header, Sélection, Corps) : apparition
// à la fin d'un morph d'entrée, disparition dès le clic qui quitte Modélisation.
const contentContainerVariants = {
  hidden: { transition: { staggerChildren: CONTENT_STAGGER_MS } },
  visible: { transition: { staggerChildren: CONTENT_STAGGER_MS } },
};

const contentGroupVariants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.22, ease: [0.4, 0, 0.2, 1] } },
};

interface ModelingSidebarProps {
  /**
   * Signale une transition d'espace en cours entre Modélisation et la pilule/les panneaux de
   * Prévisualisation, dans un sens ou dans l'autre :
   *  - 'enter' : ce panneau — déjà affiché avec son contenu réel — part de la forme/position de la
   *    pilule (ou des deux panneaux de Prévisualisation si `fromPreview`) et se déforme en un seul
   *    geste vers sa forme normale.
   *  - 'exit' : mouvement inverse — parti de sa forme normale, ce panneau se déforme vers la
   *    pilule ou les panneaux de Prévisualisation, puis Index.tsx le démonte (`onDone`) et affiche
   *    à la place les vrais panneaux slicer, déjà dans leur état final (cf. `initialPreviewActive`
   *    de CategoriesSidebar).
   *
   * Contrairement à l'ancienne approche (un calque de verre animé séparé, remplacé après coup par
   * ce panneau), c'est ICI le même élément DOM, déjà monté avec son contenu réel, qui change de
   * silhouette (`clip-path`, cf. useLiquidGlassClip) — aucun raccord entre deux éléments distincts,
   * donc aucun risque de clignotement à la jonction. Reste monté pendant tout le morph (les effets
   * de montage/démontage — restauration du mode 3D notamment — ne doivent avoir lieu qu'une fois).
   */
  morph?: { direction: 'enter' | 'exit'; fromPreview: boolean; onDone: () => void };
}

export const ModelingSidebar: React.FC<ModelingSidebarProps> = ({ morph }) => {
  const [models, setModels] = useState<ModelNode[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [activeTool, setActiveTool] = useState<FeatureKind | null>(null);
  const [sketchEntity, setSketchEntity] = useState<SketchEntityKind>('rectangle');
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('body');

  const segmentedRef = useRef<HTMLDivElement>(null);
  const segmentRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [indicatorStyle, setIndicatorStyle] = useState<React.CSSProperties>({});

  // Morph d'espace (cf. la prop `morph`) : anime directement le `clip-path` de .panel entre la
  // forme de la pilule/des panneaux Preview et sa forme normale — jamais de calque séparé à
  // raccorder, c'est ce panneau réel, déjà affiché avec son contenu, qui change de silhouette.
  //
  // `stage` est DÉRIVÉ de `morph` pendant le rendu, jamais stocké dans un état mis à jour depuis la
  // boucle RAF : l'app tourne sous `createRoot` (React 18 concurrent), où un `setState` hors
  // gestionnaire d'événement n'est commité que dans une tâche ULTÉRIEURE — donc après la peinture de
  // la frame courante. Mélanger une mutation DOM synchrone (retrait du clip-path) et un tel
  // `setState` (retrait du stage et de `.morphing`) laissait passer une frame incohérente : panneau
  // non découpé à la taille du stage (un rectangle plus large), ou masqué par le filet CSS de
  // `.morphing` (un trou « transparent » entouré de l'ombre). Ici, tout ce qui décrit « un morph est
  // en cours » disparaît dans le MÊME commit que `morph`, et le clip-path est retiré par le cleanup
  // du layout effect ci-dessous, qui s'exécute pendant ce commit, avant la peinture.
  const panelRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<LiquidGlassShadowHandle>(null);
  const stage = morph ? modelingMorphStage(window.innerHeight) : null;
  const morphRef = useRef(morph);
  morphRef.current = morph;
  // Le contenu (header, Sélection, Corps — cf. CONTENT_REVEAL_THRESHOLD) n'a de sens que quand la
  // silhouette a sa forme normale. Calculé dès l'état initial (pas seulement dans le layout effect,
  // qui ne corrigerait qu'APRÈS un premier rendu à `true`) : faux dès qu'un morph est en cours au
  // montage.
  const [contentRevealed, setContentRevealed] = useState(() => !morph);
  // Vrai dès le CLIC qui quitte Modélisation (cf. apex-leaving-modeling, dispatché par Sidebar.tsx
  // avant même que le rideau ne monte) : le contenu disparaît en cascade AVANT que la déformation ne
  // commence (à `onCovered`, ~900ms plus tard). Ce composant est démonté à la fin du morph de
  // sortie, jamais besoin de repasser à `false`.
  const [contentLeaving, setContentLeaving] = useState(false);

  useEffect(() => {
    const handleLeaving = () => setContentLeaving(true);
    window.addEventListener('apex-leaving-modeling', handleLeaving);
    return () => window.removeEventListener('apex-leaving-modeling', handleLeaving);
  }, []);

  // Layout effect : la première silhouette est posée avant le premier affichage (sinon une image
  // du panneau non clippé clignoterait — cf. aussi le filet CSS de `.panel.morphing`).
  useLayoutEffect(() => {
    if (!morph || !panelRef.current) return;
    const stage = modelingMorphStage(window.innerHeight);
    const el = panelRef.current;
    // Le contenu n'est jamais visible pendant une déformation : en entrée il n'apparaît qu'à t = 1,
    // en sortie il est déjà parti au clic (contentLeaving).
    let revealed = false;
    setContentRevealed(false);

    const pathAt = (t: number, dx: number, dy: number) =>
      modelingPathAt(morph.fromPreview, window.innerHeight, t, dx, dy - stage.dyOffset);

    const apply = (progress: number) => {
      const t = morph.direction === 'exit' ? 1 - progress : progress;
      el.style.clipPath = `path('${pathAt(t, 0, 0)}')`;
      // Depuis la Prévisualisation, le verre part du flou (plus fort) de ses panneaux.
      if (morph.fromPreview) applyGlassBlur(el, PREVIEW_GLASS_BLUR_PX, GLASS_BLUR_PX, t);
      // MÊME frame, MÊME `progress` que le panneau réel ci-dessus (cf. le commentaire de
      // LiquidGlassShadow : deux boucles RAF séparées dériveraient l'une de l'autre).
      applyLiquidGlassShadow(shadowRef, pathAt, stage.width, stage.height, morph.direction === 'exit', progress);
      const shouldReveal = morph.direction === 'enter' && t >= CONTENT_REVEAL_THRESHOLD;
      if (shouldReveal !== revealed) {
        revealed = shouldReveal;
        setContentRevealed(revealed);
      }
    };

    const duration = modelingMorphDuration(morph.fromPreview);
    apply(0);
    const start = performance.now();
    let raf = requestAnimationFrame(function tick(now) {
      const progress = Math.min(1, (now - start) / duration);
      apply(progress);
      if (progress < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        // Rien d'autre ici : ni mutation DOM, ni état de géométrie. `onDone` fait passer `morph` à
        // undefined (ou démonte ce composant en sortie) ; le commit qui en résulte retire le stage
        // et `.morphing`, et le cleanup ci-dessous efface le clip-path dans ce même commit.
        morphRef.current?.onDone();
      }
    });
    return () => {
      cancelAnimationFrame(raf);
      el.style.clipPath = '';
      el.style.backdropFilter = '';
      el.style.removeProperty('-webkit-backdrop-filter');
    };
    // Dépendre de `morph` lui-même (plutôt que ses champs primitifs) relancerait cet effet — donc
    // l'animation, depuis `t = 0` — à chaque re-render du parent pendant le morph : Index.tsx
    // construit `{ ...modelingMorph, onDone }` à chaque rendu, un nouvel objet à chaque fois, alors
    // que `onDone` (lu via morphRef, jamais capturé ici) fait toujours la même chose. `direction`/
    // `fromPreview`, eux, restent figés pour la durée de CE morph (Index.tsx ne les change jamais
    // sans démonter/remonter un nouveau cycle) : ce sont eux qui doivent déclencher l'effet, à
    // l'exclusion de toute autre cause de re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [morph?.direction, morph?.fromPreview]);

  /** Le viewport a besoin de connaître l'état initial dès le montage du panneau. */
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('apex-mode-changed', { detail: { mode: 'modeling' } }));
    window.dispatchEvent(new CustomEvent('apex-selection-mode-changed', { detail: { mode: 'body' } }));

    return () => {
      // Retour au slicer : le viewport doit restaurer plateau, boundary shader et gizmos.
      window.dispatchEvent(new CustomEvent('apex-mode-changed', { detail: { mode: 'slicer' } }));
      window.dispatchEvent(new CustomEvent('apex-tool-changed', { detail: { tool: 'select' } }));
    };
  }, []);

  /**
   * L'arborescence reflète les corps réellement présents dans la scène : on suit les mêmes
   * événements que ModelStatusBox plutôt que de tenir une liste parallèle qui divergerait.
   */
  useEffect(() => {
    const handleMeshSelected = (
      e: CustomEvent<{ name: string | null; names?: string[]; subMeshes?: SubMeshItem[] }>,
    ) => {
      const name = e.detail?.name ?? null;
      setSelectedModel(name);
      if (!name || !e.detail?.subMeshes) return;

      setModels((prev) => {
        const exists = prev.some((m) => m.name === name);
        if (!exists) {
          return [...prev, { id: nextId('body'), name, children: e.detail.subMeshes!, features: [] }];
        }
        return prev.map((m) => (m.name === name ? { ...m, children: e.detail.subMeshes! } : m));
      });
    };

    const handleMeshDeleted = (e: CustomEvent<{ name?: string }>) => {
      const deleted = e.detail?.name;
      if (deleted) {
        setModels((prev) => prev.filter((m) => m.name !== deleted));
        setSelectedModel((cur) => (cur === deleted ? null : cur));
      } else {
        setModels([]);
        setSelectedModel(null);
      }
    };

    window.addEventListener('apex-mesh-selected', handleMeshSelected as EventListener);
    window.addEventListener('apex-mesh-deleted', handleMeshDeleted as EventListener);
    window.addEventListener('apex-delete-all-models', handleMeshDeleted as EventListener);

    return () => {
      window.removeEventListener('apex-mesh-selected', handleMeshSelected as EventListener);
      window.removeEventListener('apex-mesh-deleted', handleMeshDeleted as EventListener);
      window.removeEventListener('apex-delete-all-models', handleMeshDeleted as EventListener);
    };
  }, []);

  /** Indicateur coulissant du sélecteur de granularité (même technique que AxisSidebar). */
  useEffect(() => {
    if (!segmentedRef.current) return;
    const activeBtn = segmentRefs.current.get(selectionMode);
    if (!activeBtn) return;

    const barRect = segmentedRef.current.getBoundingClientRect();
    const btnRect = activeBtn.getBoundingClientRect();
    setIndicatorStyle({
      width: btnRect.width,
      height: btnRect.height,
      left: btnRect.left - barRect.left,
      top: btnRect.top - barRect.top,
      opacity: 1,
    });
  }, [selectionMode]);

  /** L'arbre est la source de vérité : toute mutation déclenche un replay côté viewport. */
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('apex-feature-tree-updated', { detail: { models } }));
  }, [models]);

  const handleSelectionMode = (mode: SelectionMode) => {
    setSelectionMode(mode);
    window.dispatchEvent(new CustomEvent('apex-selection-mode-changed', { detail: { mode } }));
  };

  const targetModel = models.find((m) => m.name === selectedModel) ?? null;

  // Le choix du plan d'esquisse se fait de façon asynchrone dans le viewport (l'utilisateur
  // clique une plaque de plan ou une face) : au moment où `apex-sketch-plane-selected`
  // arrive, il faut le corps ciblé et la forme active *à cet instant*, pas ceux capturés à
  // l'inscription du listener — d'où ces refs tenues à jour à chaque rendu.
  const targetModelRef = useRef<ModelNode | null>(targetModel);
  useEffect(() => { targetModelRef.current = targetModel; }, [targetModel]);
  const sketchEntityRef = useRef<SketchEntityKind>(sketchEntity);
  useEffect(() => { sketchEntityRef.current = sketchEntity; }, [sketchEntity]);

  /** Reçoit le plan choisi dans le viewport et crée seulement alors la feature esquisse. */
  useEffect(() => {
    const handlePlaneSelected = (e: CustomEvent<SketchPlaneRef>) => {
      const planeRef = e.detail;
      const model = targetModelRef.current;

      if (!model) {
        // Pas de corps existant : l'esquisse reste « flottante » jusqu'à l'extrusion, qui
        // en créera un — rien à stocker dans l'arborescence pour l'instant.
        window.dispatchEvent(
          new CustomEvent('apex-sketch-tool', { detail: { entity: sketchEntityRef.current, sketchId: null, planeRef } }),
        );
        return;
      }

      const id = nextId('sketch');
      const index = model.features.filter((f) => f.kind === 'sketch').length + 1;
      const name = `${FEATURE_LABELS.sketch} ${index}`;
      const feature: Feature = { id, name, kind: 'sketch', planeRef, entities: [] };

      setModels((prev) => prev.map((m) => (m.id === model.id ? { ...m, features: [...m.features, feature] } : m)));
      setSelectedFeatureId(id);
      setExpanded((prev) => ({ ...prev, [model.id]: true }));
      showSuccess(`${name} ajoutée à ${model.name}.`);
      window.dispatchEvent(
        new CustomEvent('apex-sketch-tool', { detail: { entity: sketchEntityRef.current, sketchId: id, planeRef } }),
      );
    };

    window.addEventListener('apex-sketch-plane-selected', handlePlaneSelected as EventListener);
    return () => window.removeEventListener('apex-sketch-plane-selected', handlePlaneSelected as EventListener);
  }, []);

  const handleToolClick = (kind: FeatureKind) => {
    // Re-cliquer sur l'outil actif le désactive (même convention que la Sidebar principale).
    if (activeTool === kind) {
      setActiveTool(null);
      window.dispatchEvent(new CustomEvent('apex-tool-changed', { detail: { tool: 'select' } }));
      if (kind === 'sketch') window.dispatchEvent(new CustomEvent('apex-sketch-plane-pick-cancel'));
      return;
    }

    if (!targetModel && kind !== 'sketch') {
      showError('Sélectionnez un corps dans l\'arborescence.');
      return;
    }

    const sketchId = targetModel?.features.filter((f) => f.kind === 'sketch').slice(-1)[0]?.id ?? null;
    if ((kind === 'extrude' || kind === 'revolve') && !sketchId) {
      showError('Créez d\'abord une esquisse à extruder.');
      return;
    }

    setActiveTool(kind);
    window.dispatchEvent(new CustomEvent('apex-tool-changed', { detail: { tool: kind } }));

    if (kind === 'sketch') {
      // Le plan se choisit dans le viewport (plaque d'axe ou face d'un corps) : la feature
      // n'est créée qu'à la réception de `apex-sketch-plane-selected` (effet dédié plus haut).
      window.dispatchEvent(new CustomEvent('apex-sketch-plane-pick-start'));
      return;
    }

    if (!targetModel) return; // uniquement possible pour 'sketch', déjà traité ci-dessus

    const id = nextId(kind);
    const index = targetModel.features.filter((f) => f.kind === kind).length + 1;
    const name = `${FEATURE_LABELS[kind]} ${index}`;

    let feature: Feature;
    switch (kind) {
      case 'extrude':
        feature = { id, name, kind, sketchId: sketchId!, distance: 10, symmetric: false };
        break;
      case 'revolve':
        feature = { id, name, kind, sketchId: sketchId!, axis: { x: 0, y: 1, z: 0 }, angle: 360 };
        break;
      case 'fillet':
        feature = { id, name, kind, targetIds: [], radius: 2 };
        break;
      case 'chamfer':
        feature = { id, name, kind, targetIds: [], distance: 2 };
        break;
      case 'mirror':
        feature = { id, name, kind, center: { x: 0, y: 0, z: 0 } };
        break;
    }

    setModels((prev) =>
      prev.map((m) => (m.id === targetModel.id ? { ...m, features: [...m.features, feature] } : m)),
    );
    setSelectedFeatureId(id);
    setExpanded((prev) => ({ ...prev, [targetModel.id]: true }));
    showSuccess(`${name} ajoutée à ${targetModel.name}.`);
  };

  const handleSketchEntity = (kind: SketchEntityKind) => {
    setSketchEntity(kind);
    const sketchId =
      targetModel?.features.find((f) => f.id === selectedFeatureId && f.kind === 'sketch')?.id ?? null;
    window.dispatchEvent(new CustomEvent('apex-sketch-tool', { detail: { entity: kind, sketchId } }));
  };

  const updateFeature = (modelId: string, featureId: string, patch: Partial<Feature>) => {
    setModels((prev) =>
      prev.map((m) =>
        m.id !== modelId
          ? m
          : { ...m, features: m.features.map((f) => (f.id === featureId ? ({ ...f, ...patch } as Feature) : f)) },
      ),
    );
  };

  const deleteFeature = (modelId: string, featureId: string) => {
    setModels((prev) =>
      prev.map((m) => (m.id !== modelId ? m : { ...m, features: m.features.filter((f) => f.id !== featureId) })),
    );
    setSelectedFeatureId((cur) => (cur === featureId ? null : cur));
  };

  const toggleSuppress = (modelId: string, featureId: string) => {
    setModels((prev) =>
      prev.map((m) =>
        m.id !== modelId
          ? m
          : { ...m, features: m.features.map((f) => (f.id === featureId ? { ...f, suppressed: !f.suppressed } : f)) },
      ),
    );
  };

  const selectModelInViewport = (name: string) => {
    setSelectedModel(name);
    window.dispatchEvent(new CustomEvent('apex-select-model', { detail: { name } }));
  };

  const toggleExpand = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const selectedFeature =
    targetModel?.features.find((f) => f.id === selectedFeatureId) ?? null;

  // Slot exposé par Sidebar (même conteneur physique que la barre d'outils slicer, voir
  // Sidebar.tsx) : Sidebar est toujours monté en parallèle, donc le noeud existe déjà quand
  // ce composant apparaît — pas de souci d'ordre de montage à gérer.
  const [toolbarSlot, setToolbarSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setToolbarSlot(document.getElementById('apex-modeling-toolbar-slot'));
  }, []);

  return (
    <>
      {/* Pendant le morph (cf. `morph`), l'ombre portée est un calque séparé qui épouse la même
          silhouette animée que .panel — box-shadow ne suivrait pas un clip-path complexe, il
          resterait un rectangle fixe pendant que le contenu change de forme. Composant purement
          passif : pilotée par `shadowRef`, dans la MÊME boucle RAF que .panel (cf. le
          useLayoutEffect plus haut), jamais par sa propre boucle indépendante. */}
      {stage && (
        <LiquidGlassShadow
          left={stage.left}
          top={stage.top}
          width={stage.width}
          height={stage.height}
          shadowRef={shadowRef}
        />
      )}

      {/* ---------- Panneau latéral : arborescence des corps ---------- */}
      {/* Ni ce conteneur ni .panel ne sont des motion.div : Framer Motion pose un `transform`
          inline sur tout ce qu'il anime, ce qui créerait un contexte d'empilement sur un ANCÊTRE
          du panneau à `backdrop-filter` (cf. le commentaire de tête de LiquidGlassMorph.tsx). */}
      <div
        className={styles.container}
        data-apex-chrome-panel
        style={
          stage
            ? { position: 'fixed', left: stage.left, top: stage.top, width: stage.width, height: stage.height, maxHeight: 'none' }
            : undefined
        }
      >
        <div
          ref={panelRef}
          className={clsx(styles.panel, { [styles.morphing]: !!stage })}
        >
          {/* Jamais visible pendant une déformation : apparaît en cascade (header, Sélection,
              Corps) une fois un morph d'entrée terminé, disparaît de même dès le clic qui quitte
              Modélisation (contentLeaving). Hors morph, `animate="visible"` sans délai. */}
          <motion.div
            variants={contentContainerVariants}
            initial={false}
            animate={contentRevealed && !contentLeaving ? 'visible' : 'hidden'}
          >
          <motion.div className={styles.header} variants={contentGroupVariants}>
            <Box className={clsx('w-4 h-4', styles.headerIcon)} />
            Modélisation
          </motion.div>

          <motion.div variants={contentGroupVariants}>
          <div className={styles.sectionLabel}>Sélection</div>
          <div ref={segmentedRef} className={styles.segmented}>
            <div className={styles.activeIndicator} style={indicatorStyle} />
            {SELECTION_MODES.map(({ mode, label, enabled }) => (
              <CustomTooltip
                key={mode}
                content={label}
                description={enabled ? `Sélectionner par ${label.toLowerCase()}.` : 'Arrive bientôt.'}
              >
                <button
                  ref={(el) => { if (el) segmentRefs.current.set(mode, el); }}
                  className={clsx(styles.segmentButton, { [styles.active]: selectionMode === mode })}
                  onClick={() => handleSelectionMode(mode)}
                  disabled={!enabled}
                >
                  {label}
                </button>
              </CustomTooltip>
            ))}
          </div>
          </motion.div>

          <motion.div variants={contentGroupVariants}>
          <div className={styles.sectionLabel}>Corps</div>
          <div className={styles.treeScroll}>
            {models.length === 0 ? (
              <div className={styles.emptyState}>
                Aucun corps dans la scène.<br />
                Importez un modèle ou créez une esquisse.
              </div>
            ) : (
              <ul className={styles.treeList}>
                <AnimatePresence initial={false}>
                  {models.map((model) => {
                    const isExpanded = !!expanded[model.id];
                    const hasChildren = model.children.length > 0 || model.features.length > 0;

                    return (
                      <motion.li
                        key={model.id}
                        className={styles.treeNode}
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                      >
                        <div
                          role="button"
                          tabIndex={0}
                          className={clsx(styles.treeRow, {
                            [styles.selected]: selectedModel === model.name,
                          })}
                          onClick={() => selectModelInViewport(model.name)}
                          onKeyDown={(e) => { if (e.key === 'Enter') selectModelInViewport(model.name); }}
                        >
                          {hasChildren ? (
                            <ChevronRight
                              className={clsx('w-3 h-3', styles.chevron, { [styles.expanded]: isExpanded })}
                              onClick={(e) => toggleExpand(e, model.id)}
                            />
                          ) : (
                            <span className={styles.chevronSpacer} />
                          )}
                          <Box className={clsx('w-3.5 h-3.5', styles.nodeIcon)} />
                          <span className={styles.nodeName}>{model.name}</span>
                        </div>

                        <AnimatePresence initial={false}>
                          {isExpanded && hasChildren && (
                            <motion.ul
                              className={styles.childList}
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                            >
                              {model.children.map((sub) => (
                                <li key={sub.id} className={styles.childRow}>
                                  <span className={styles.childDot} style={{ background: sub.color }} />
                                  {sub.name}
                                </li>
                              ))}

                              {model.features.map((feature) => {
                                const Icon = FEATURE_ICONS[feature.kind];
                                return (
                                  <li key={feature.id}>
                                    <div
                                      role="button"
                                      tabIndex={0}
                                      className={clsx(styles.treeRow, styles.featureRow, {
                                        [styles.selected]: selectedFeatureId === feature.id,
                                        [styles.suppressed]: feature.suppressed,
                                        [styles.errored]: !!feature.error,
                                      })}
                                      onClick={() => setSelectedFeatureId(feature.id)}
                                      onKeyDown={(e) => { if (e.key === 'Enter') setSelectedFeatureId(feature.id); }}
                                    >
                                      <Icon className={clsx('w-3 h-3', styles.nodeIcon)} />
                                      <span className={styles.nodeName}>{feature.name}</span>
                                      <button
                                        className={styles.nodeAction}
                                        title={feature.suppressed ? 'Réactiver' : 'Supprimer du calcul'}
                                        onClick={(e) => { e.stopPropagation(); toggleSuppress(model.id, feature.id); }}
                                      >
                                        {feature.suppressed ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                                      </button>
                                      <button
                                        className={styles.nodeAction}
                                        title="Supprimer"
                                        onClick={(e) => { e.stopPropagation(); deleteFeature(model.id, feature.id); }}
                                      >
                                        <Trash2 className="w-3 h-3" />
                                      </button>
                                    </div>
                                  </li>
                                );
                              })}
                            </motion.ul>
                          )}
                        </AnimatePresence>
                      </motion.li>
                    );
                  })}
                </AnimatePresence>
              </ul>
            )}
          </div>
          </motion.div>
          </motion.div>

          {/* ---- Paramètres de la feature sélectionnée ---- */}
          <AnimatePresence initial={false}>
            {selectedFeature && targetModel && (
              <motion.div
                className={styles.params}
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
              >
                <div className={styles.paramsTitle}>{selectedFeature.name}</div>

                {selectedFeature.kind === 'sketch' && selectedFeature.planeRef.kind === 'axis' && (
                  <div className={styles.paramRow}>
                    <span className={styles.paramLabel}>Plan</span>
                    <select
                      className={styles.paramSelect}
                      value={selectedFeature.planeRef.plane}
                      onChange={(e) =>
                        updateFeature(targetModel.id, selectedFeature.id, {
                          planeRef: { kind: 'axis', plane: e.target.value as SketchPlane },
                        })
                      }
                    >
                      {/* Repère Babylon, Y vertical : XZ est le plan du sol (dessus). */}
                      <option value="XZ">XZ (dessus)</option>
                      <option value="XY">XY (face)</option>
                      <option value="YZ">YZ (côté)</option>
                    </select>
                  </div>
                )}

                {selectedFeature.kind === 'sketch' && selectedFeature.planeRef.kind === 'face' && (
                  <div className={styles.paramRow}>
                    <span className={styles.paramLabel}>Plan</span>
                    <span className={styles.paramLabel} style={{ color: 'rgba(0,240,255,0.85)' }}>
                      Face sélectionnée
                    </span>
                  </div>
                )}

                {selectedFeature.kind === 'extrude' && (
                  <>
                    <div className={styles.paramRow}>
                      <span className={styles.paramLabel}>Distance (mm)</span>
                      <input
                        type="number"
                        className={styles.paramInput}
                        value={selectedFeature.distance}
                        step={0.5}
                        onChange={(e) =>
                          updateFeature(targetModel.id, selectedFeature.id, { distance: Number(e.target.value) })
                        }
                      />
                    </div>
                    <div className={styles.paramRow}>
                      <label className={styles.paramToggle}>
                        <input
                          type="checkbox"
                          checked={selectedFeature.symmetric}
                          onChange={(e) =>
                            updateFeature(targetModel.id, selectedFeature.id, { symmetric: e.target.checked })
                          }
                        />
                        Symétrique
                      </label>
                    </div>
                  </>
                )}

                {selectedFeature.kind === 'revolve' && (
                  <div className={styles.paramRow}>
                    <span className={styles.paramLabel}>Angle (°)</span>
                    <input
                      type="number"
                      className={styles.paramInput}
                      value={selectedFeature.angle}
                      min={1}
                      max={360}
                      onChange={(e) =>
                        updateFeature(targetModel.id, selectedFeature.id, { angle: Number(e.target.value) })
                      }
                    />
                  </div>
                )}

                {selectedFeature.kind === 'fillet' && (
                  <div className={styles.paramRow}>
                    <span className={styles.paramLabel}>Rayon (mm)</span>
                    <input
                      type="number"
                      className={styles.paramInput}
                      value={selectedFeature.radius}
                      step={0.5}
                      min={0.1}
                      onChange={(e) =>
                        updateFeature(targetModel.id, selectedFeature.id, { radius: Number(e.target.value) })
                      }
                    />
                  </div>
                )}

                {selectedFeature.kind === 'chamfer' && (
                  <div className={styles.paramRow}>
                    <span className={styles.paramLabel}>Distance (mm)</span>
                    <input
                      type="number"
                      className={styles.paramInput}
                      value={selectedFeature.distance}
                      step={0.5}
                      min={0.1}
                      onChange={(e) =>
                        updateFeature(targetModel.id, selectedFeature.id, { distance: Number(e.target.value) })
                      }
                    />
                  </div>
                )}

                {selectedFeature.kind === 'mirror' && (
                  <div className={styles.paramRow}>
                    <span className={styles.paramLabel}>Centre X</span>
                    <input
                      type="number"
                      className={styles.paramInput}
                      value={selectedFeature.center.x}
                      onChange={(e) =>
                        updateFeature(targetModel.id, selectedFeature.id, {
                          center: { ...selectedFeature.center, x: Number(e.target.value) },
                        })
                      }
                    />
                  </div>
                )}

                {(selectedFeature.kind === 'fillet' || selectedFeature.kind === 'chamfer') && (
                  <div className={styles.paramRow}>
                    <span className={styles.paramLabel}>
                      <MousePointerSquareDashed className="w-3 h-3 inline mr-1" />
                      {selectedFeature.targetIds.length} face(s) sélectionnée(s)
                    </span>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ---------- Boutons d'opérations CAD ----------
          Injectés par portail dans le même conteneur physique que la barre d'outils slicer
          (voir Sidebar.tsx : c'est LUI qui se vide/se déplace/se déforme entre les modes,
          pas un composant séparé qui apparaît par-dessus) — ici on ne possède que la
          logique (activeTool, handleToolClick, création de features), pas le conteneur. */}
      {toolbarSlot && createPortal(
        <>
          {TOOLS.map(({ kind, icon: Icon, description }) => (
            <CustomTooltip key={kind} content={FEATURE_LABELS[kind]} description={description}>
              <button
                className={clsx(styles.barButton, { [styles.active]: activeTool === kind })}
                onClick={() => handleToolClick(kind)}
                aria-label={FEATURE_LABELS[kind]}
              >
                <Icon className="w-5 h-5" />
              </button>
            </CustomTooltip>
          ))}
        </>,
        toolbarSlot,
      )}

      {/* ---------- Petite barre des formes d'esquisse, juste sous la barre principale ---------- */}
      <AnimatePresence initial={false}>
        {activeTool === 'sketch' && (
          <motion.div
            className={styles.sketchBar}
            data-apex-chrome-panel
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
          >
            <div className={styles.sketchBarInner}>
              {SKETCH_ENTITIES.map(({ kind, icon: Icon }) => (
                <CustomTooltip
                  key={kind}
                  content={SKETCH_ENTITY_LABELS[kind]}
                  description="Sommets connectables aux autres formes de l'esquisse."
                >
                  <button
                    className={clsx(styles.barButton, { [styles.active]: sketchEntity === kind })}
                    onClick={() => handleSketchEntity(kind)}
                    aria-label={SKETCH_ENTITY_LABELS[kind]}
                  >
                    <Icon className="w-5 h-5" />
                  </button>
                </CustomTooltip>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
