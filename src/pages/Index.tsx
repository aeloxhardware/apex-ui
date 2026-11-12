"use client";

import React, { useEffect, useRef, useState } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { FileSidebar } from '@/components/FileSidebar';
import { SliceSidebar } from '@/components/SliceSidebar';
import { EngineSettingsPanel } from '@/components/EngineSettingsPanel';
import { CategoriesSidebar } from '@/components/CategoriesSidebar';
import { PrinterConfigSidebar } from '@/components/PrinterConfigSidebar';
import { AxisSidebar } from '@/components/AxisSidebar';
import { ModelingSidebar } from '@/components/ModelingSidebar';
import { TopRightMenu } from '@/components/TopRightMenu';
import { ModelStatusBox } from '@/components/ModelStatusBox';
import { FILAMENT_CHANGED_EVENT, getSelectedFilamentKey } from '@/utils/filamentCatalog';
import { ModelHoverTooltip } from '@/components/ModelHoverTooltip';
import { TextureEditorModal } from '@/components/TextureEditorModal';
import { SliceModal } from '@/components/SliceModal';
import { getSlicingMode, triangleSafetyThreshold } from '@/utils/slicingMode';
import { SlicingProgressModal } from '@/components/SlicingProgressModal';
import { sliceController } from '@/utils/sliceController';
import { ViewCube } from '@/components/ViewCube';
import { Viewport3D } from '@/components/Viewport3D';
import { SpaceTransitionOverlay } from '@/components/SpaceTransitionOverlay';
import { ParamsPanel } from '@/components/ParamsPanel';
import { HomePanel } from '@/components/HomePanel';
import { GCodePreview } from '@/components/GCodePreview';
import { GCodePreviewBar } from '@/components/GCodePreviewBar';
import { GCodeSpeedSelector } from '@/components/GCodeSpeedSelector';
import { GCodeLineTypeLegend } from '@/components/GCodeLineTypeLegend';
import { GCodeInfoPanel } from '@/components/GCodeInfoPanel';
import { PreviewUpperTabs } from '@/components/PreviewUpperTabs';
import { DitherOverlay } from '@/components/DitherOverlay';
import { GCodeConversionCard } from '@/components/GCodeConversionCard';
import { UnlayeredDetectedDialog } from '@/components/UnlayeredDetectedDialog';
import { useGCodePreview } from '@/hooks/use-gcode-preview';
import { useResumeCategory } from '@/hooks/use-resume-category';
import { useAnimate, motion, AnimatePresence } from 'framer-motion';
import { Box } from 'lucide-react';
import { showSuccess } from '@/utils/toast';
import { BetaWatermark, BetaBanners } from '@/components/BetaWatermark';
import { AmsPanel } from '@/components/ams/AmsPanel';
import { useDevMode } from '@/utils/devModePrefs';
import { setModelingSpace } from '@/utils/modelingSpace';

import { readProfile } from '@/utils/printerProfiles';
import { setActivePrinterNozzle } from '@/utils/aeolisNozzle';
import { DEFAULT_PRINTER_NAME, DEFAULT_PRINTER_PROFILE, profileAxes } from '@/utils/machineProfile';

import { emitApex } from '@/events/apexEvents';
interface ModelStatus {
  name: string;
  dimensions: { x: number; y: number; z: number } | null;
}

type ActiveTab = '3d-view' | 'settings' | 'developer' | 'params' | 'home';
type ModelingMorph = { direction: 'enter' | 'exit'; fromPreview: boolean } | null;

/** Imprimante et filament choisis, et nombre d'axes de l'imprimante lu dans son profil. */
function usePrinterSelection() {
  const [selectedPrinter, setSelectedPrinter] = useState(DEFAULT_PRINTER_NAME);
  // Nombre d'axes de l'imprimante choisie, lu dans son profil (`apex.axes_count`) ; tant qu'aucune n'est choisie
  // dans le menu, c'est celui du profil par défaut (machineProfile.ts). `null` : profil muet ou « Inconnu ».
  const [printerAxes, setPrinterAxes] = useState<number | null>(() => profileAxes(DEFAULT_PRINTER_PROFILE));
  const handleSelectPrinter = (name: string, path?: string) => {
    setSelectedPrinter(name);
    if (!path) return;
    readProfile(path)
      .then((p) => {
        setPrinterAxes(p.status === 'ok' ? profileAxes(p.data) : null);
        // La buse est propre à l'imprimante : son profil fixe les valeurs de départ des réglages de buse.
        setActivePrinterNozzle(name, p.status === 'ok' ? p.data : null);
      })
      .catch(() => { setPrinterAxes(null); setActivePrinterNozzle(name, null); });
  };
  const [selectedFilament, setSelectedFilament] = useState(() => getSelectedFilamentKey().split('|')[1]);
  useEffect(() => {
    const onChanged = (e: Event) => setSelectedFilament((e as CustomEvent<{ key: string }>).detail.key.split('|')[1]);
    window.addEventListener(FILAMENT_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(FILAMENT_CHANGED_EVENT, onChanged);
  }, []);
  return { selectedPrinter, printerAxes, handleSelectPrinter, selectedFilament, setSelectedFilament };
}

/** Modèle sélectionné / importé (pastille de statut) et état Prévisualisation, par événements `apex-*`. */
function useSpaceEvents() {
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null);
  const [isPreviewActive, setIsPreviewActive] = useState(false);
  useEffect(() => {
    const handleModelSelected = (event: CustomEvent<{
      name: string | null;
      dimensions?: { x: number; y: number; z: number };
    }>) => {
      if (!event.detail?.name) {
        setModelStatus(null);
        return;
      }
      setModelStatus({ name: event.detail.name, dimensions: event.detail.dimensions ?? null });
    };
    const handleModelImported = (event: CustomEvent<File>) => {
      if (event.detail?.name) {
        setModelStatus({ name: event.detail.name, dimensions: null });
      }
    };
    const handlePreviewToggled = (event: CustomEvent<{ active: boolean }>) => {
      setIsPreviewActive(!!event.detail?.active);
    };
    window.addEventListener('apex-mesh-selected', handleModelSelected as EventListener);
    window.addEventListener('apex-import-model', handleModelImported as EventListener);
    window.addEventListener('apex-preview-toggled', handlePreviewToggled as EventListener);
    return () => {
      window.removeEventListener('apex-mesh-selected', handleModelSelected as EventListener);
      window.removeEventListener('apex-import-model', handleModelImported as EventListener);
      window.removeEventListener('apex-preview-toggled', handlePreviewToggled as EventListener);
    };
  }, []);
  return { modelStatus, isPreviewActive };
}

/**
 * Au changement d'espace, la barre d'aide (TopRightMenu) passe par le coin bas gauche, là où
 * se trouve la barre de statut : celle-ci se rentre sous le bord de l'écran juste avant
 * (0,2 → 0,45 s ; la barre d'aide démarre à 0,495 s) et ressort une fois la barre d'aide
 * arrivée (1,1 s), pour ne pas se faire recouvrir.
 */
function useStatusBarSlide(isPreviewActive: boolean) {
  const [statusBarRef, animateStatusBar] = useAnimate<HTMLDivElement>();
  const prevPreviewActiveRef = useRef(isPreviewActive);
  useEffect(() => {
    if (prevPreviewActiveRef.current === isPreviewActive) return;
    prevPreviewActiveRef.current = isPreviewActive;
    if (!statusBarRef.current) return;
    animateStatusBar(
      statusBarRef.current,
      { y: [0, 0, 80, 80, 0] },
      { duration: 1.4, times: [0, 0.2 / 1.4, 0.45 / 1.4, 1.1 / 1.4, 1], ease: [0.25, 1, 0.5, 1] },
    );
  }, [isPreviewActive, animateStatusBar, statusBarRef]);
  return statusBarRef;
}

/**
 * Préchargement (interface moderne) : l'application s'ouvre sur l'Accueil, sans 3D. Un Viewport3D invisible
 * est monté au lancement, le temps que son moteur, ses shaders et ses modèles soient prêts (le splash
 * l'attend, cf. main.tsx), puis démonté : aucune scène ne tourne en fond. Le premier passage en 3D
 * retrouve ainsi des caches chauds au lieu de tout initialiser.
 */
function useViewportWarmup(isParams: boolean) {
  const [warmingViewport, setWarmingViewport] = useState(true);
  useEffect(() => {
    if (!warmingViewport) return;
    const done = () => window.setTimeout(() => setWarmingViewport(false), 0);
    window.addEventListener('apex-viewport-ready', done, { once: true });
    return () => window.removeEventListener('apex-viewport-ready', done);
  }, [warmingViewport]);
  // Si l'utilisateur quitte l'Accueil avant la fin du préchargement, le vrai viewport prend le relais.
  useEffect(() => {
    if (!isParams) setWarmingViewport(false);
  }, [isParams]);
  return warmingViewport;
}

/**
 * Déformation de ModelingSidebar entre la forme de la pilule / des deux panneaux de Prévisualisation et
 * sa forme normale (prop `morph`) : c'est le même élément, déjà affiché avec son contenu réel, qui change
 * de forme. `leavingToModeling` est vrai dès le CLIC vers Modélisation (apex-entering-modeling), pour que le
 * fondu du panneau du bas se voie à travers le rideau qui monte ; `arrivingFromModeling`, du début d'un morph
 * de sortie jusqu'au commit où CategoriesSidebar, remontée, le lit (une seule fois, à son montage).
 */
function useModelingMorphState(isModeling: boolean) {
  const [modelingMorph, setModelingMorph] = useState<ModelingMorph>(null);
  const [leavingToModeling, setLeavingToModeling] = useState(false);
  const [arrivingFromModeling, setArrivingFromModeling] = useState(false);
  // Dispatché par Sidebar.tsx (handleTopTabClick) au tout début du clic vers Modélisation, avant
  // même que le rideau plein écran ne commence à monter.
  useEffect(() => {
    const handleEnteringModeling = () => setLeavingToModeling(true);
    window.addEventListener('apex-entering-modeling', handleEnteringModeling);
    return () => window.removeEventListener('apex-entering-modeling', handleEnteringModeling);
  }, []);
  // Une fois CategoriesSidebar démontée par le passage en Modélisation, `leavingToModeling` peut
  // redescendre : prêt (`false`) pour un futur cycle.
  useEffect(() => {
    if (isModeling) setLeavingToModeling(false);
  }, [isModeling]);
  useEffect(() => {
    if (!modelingMorph) setArrivingFromModeling(false);
  }, [modelingMorph]);
  return { modelingMorph, setModelingMorph, leavingToModeling, arrivingFromModeling, setArrivingFromModeling };
}

/**
 * Lancement du tranchage : sous le seuil de sécurité de l'algorithme choisi, la demande est exécutée sans
 * confirmation ; au-dessus, la fenêtre « Lancer la découpe » prévient d'abord (slicingMode.ts : triangleSafetyThreshold).
 */
function useSliceFlow() {
  const [isSliceModalOpen, setIsSliceModalOpen] = useState(false);
  const [isSlicingProgressOpen, setIsSlicingProgressOpen] = useState(false);

  const handleConfirmSlice = () => {
    emitApex('apex-slice-all-models');
    setIsSliceModalOpen(false);
    setIsSlicingProgressOpen(true);
    void sliceController.start();
  };

  const handleSlice = () => {
    let triangles = 0;
    const onModels = (e: Event) => { triangles = (e as CustomEvent<{ triangles?: number }>).detail?.triangles ?? 0; };
    window.addEventListener('apex-slice-models', onModels);
    emitApex('apex-request-slice-models'); // réponse synchrone de Viewport3D
    window.removeEventListener('apex-slice-models', onModels);
    if (triangles > triangleSafetyThreshold(getSlicingMode())) setIsSliceModalOpen(true);
    else handleConfirmSlice();
  };

  const handleSlicingFinished = () => {
    setIsSlicingProgressOpen(false);
    const file = sliceController.getState().gcodeFile;
    sliceController.reset();
    if (file) emitApex('apex-open-sliced-gcode', { file });
  };

  return {
    isSliceModalOpen, setIsSliceModalOpen, isSlicingProgressOpen, setIsSlicingProgressOpen,
    handleSlice, handleConfirmSlice, handleSlicingFinished,
  };
}

const handleOpenModel = () => {
  showSuccess("Select an STL or GLB file to add a model.");
};

const handleSaveProject = () => {
  showSuccess("Project saved successfully.");
};

type GCodePreviewState = ReturnType<typeof useGCodePreview>;

/** Panneaux de Prévisualisation (légende, infos, conversion, vitesse) confiés à CategoriesSidebar. */
const PreviewPanels = {
  upper: (gp: GCodePreviewState) => (
    <PreviewUpperTabs coloration={
      <GCodeLineTypeLegend
        fileInfo={gp.fileInfo}
        visibility={gp.lineVisibility}
        onToggle={gp.setLineVisible}
        colorBy={gp.colorBy}
        setColorBy={gp.setColorBy}
        activeColorByScope={gp.activeColorByScope}
        setColorByScope={gp.setColorByScope}
        renderPrecisionBounds={gp.renderPrecisionBounds}
        activeRenderPrecisionMm={gp.activeRenderPrecisionMm}
        setRenderPrecision={gp.setRenderPrecision}
        pickingPoint={gp.isPickingPoint}
        onTogglePickPoint={gp.togglePickPoint}
      />
    } />
  ),
  below: (gp: GCodePreviewState, printerAxes: number | null) => (
    <GCodeConversionCard
      // Un G-code 3 axes ne demande une conversion polaire que pour une machine à axes rotatifs (4 ou 5) :
      // une imprimante 3 axes (ou au nombre d'axes inconnu) l'imprime tel quel, la carte reste cachée.
      source={printerAxes !== null && printerAxes >= 4 ? gp.conversionSource : null}
      conversion={gp.conversion}
      onConvert={gp.convert}
      onHighlightOffPlate={gp.setOffPlateHighlight}
      available={gp.conversionAvailable}
    />
  ),
  lower: (gp: GCodePreviewState) => (
    <GCodeSpeedSelector
      speed={gp.speed}
      setSpeed={gp.setSpeed}
      showFullHead={gp.showFullHead}
      setShowFullHead={gp.setShowFullHead}
    />
  ),
};

/** Raison pour laquelle l'export G-code de Prévisualisation est indisponible. */
const exportReason = (gp: GCodePreviewState) => !gp.fileInfo
  ? 'Chargez un G-code pour pouvoir l’exporter.'
  : gp.conversion.status === 'running'
    ? 'Conversion en cours…'
    : "Convertissez d'abord le G-code 3 axes en polaire (carte Conversion, sous les panneaux).";

/** Pastille de statut du plateau (modèle posé, dimensions), animée à l'apparition. */
const ModelStatusPill: React.FC<{ modelStatus: ModelStatus | null; pillRef: React.Ref<HTMLDivElement> }> = ({ modelStatus, pillRef }) => (
  <div ref={pillRef} className="shrink-0">
    <div
      data-apex-tooltip={modelStatus
        ? `Modèle « ${modelStatus.name} » posé sur le plateau${modelStatus.dimensions
          ? ` : ${modelStatus.dimensions.x.toFixed(1)} × ${modelStatus.dimensions.z.toFixed(1)} × ${modelStatus.dimensions.y.toFixed(1)} mm`
          : ''}, prêt à être découpé.`
        : "Aucun modèle n'est posé sur le plateau : importez-en un ou déposez un fichier pour commencer."}
      className="bg-[rgba(10,15,26,0.25)] backdrop-blur-[4px] -webkit-backdrop-blur-[4px] border-none rounded-lg px-3 py-2 text-xs text-zinc-300 flex items-center space-x-4 pointer-events-auto shadow-[0_8px_32px_0_rgba(0,0,0,0.4),0_2px_8px_0_rgba(0,0,0,0.3)]"
    >
      <AnimatePresence mode="wait">
        {modelStatus ? (
          <motion.div
            key="model-status"
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="flex items-center space-x-4"
          >
            <span className="flex items-center"><Box className="w-3.5 h-3.5 mr-1.5 text-blue-400" /> {modelStatus.name}</span>
            {modelStatus.dimensions && (
              <>
                <span className="text-zinc-600">|</span>
                <span>Dimensions: {modelStatus.dimensions.x.toFixed(1)} x {modelStatus.dimensions.z.toFixed(1)} x {modelStatus.dimensions.y.toFixed(1)} mm</span>
              </>
            )}
            <span className="text-zinc-600">|</span>
            <span className="text-emerald-400 font-medium">Ready to slice</span>
          </motion.div>
        ) : (
          <motion.span
            key="no-model"
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="text-zinc-400"
          >
            Aucun modèle sur le plateau
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  </div>
);

interface SpacePanelsProps {
  activeTab: ActiveTab;
  isModeling: boolean;
  modelingMorph: ModelingMorph;
  setModelingMorph: (morph: ModelingMorph) => void;
  activeCategory: string | null;
  setActiveCategory: (category: string | null) => void;
  /** Menu de catégorie à rouvrir au retour de la Prévisualisation (cf. useResumeCategory). */
  resumeCategory: string | null;
  isPrinterConfigOpen: boolean;
  setIsPrinterConfigOpen: (open: boolean) => void;
  isPreviewActive: boolean;
  arrivingFromModeling: boolean;
  leavingToModeling: boolean;
  gcodePreview: GCodePreviewState;
  printer: ReturnType<typeof usePrinterSelection>;
  onSlice: () => void;
}

/** Panneaux latéraux : soit Modélisation, soit ceux du slicer (Préparation / Prévisualisation). */
const SpacePanels: React.FC<SpacePanelsProps> = ({
  activeTab, isModeling, modelingMorph, setModelingMorph, activeCategory, setActiveCategory, resumeCategory,
  isPrinterConfigOpen, setIsPrinterConfigOpen, isPreviewActive, arrivingFromModeling, leavingToModeling,
  gcodePreview, printer, onSlice,
}) => (
  <>
  {/* Les panneaux slicer et le panneau modélisation s'excluent mutuellement. La bascule se fait
      TOUJOURS dans un seul commit, par un rendu conditionnel simple — jamais via
      AnimatePresence, qui retarde le démontage de l'ancien côté (et en mode 'wait', le
      montage du nouveau) d'au moins une tâche, donc d'au moins une frame peinte. Toute
      l'animation visible est portée ailleurs : la déformation par ModelingSidebar (prop
      `morph`), les fondus par `animate` dès le clic. */}
  {isModeling || modelingMorph?.direction === 'exit' ? (
    <ModelingSidebar
      morph={modelingMorph ? { ...modelingMorph, onDone: () => setModelingMorph(null) } : undefined}
    />
  ) : (
    <>
      <CategoriesSidebar
        activeCategory={activeCategory}
        resumeCategory={resumeCategory}
        onSelectCategory={(cat) => {
          setActiveCategory(cat);
          if (cat) setIsPrinterConfigOpen(false);
        }}
        // Remonté à la fin d'un morph de sortie de Modélisation : ce composant doit apparaître
        // directement dans la forme que ModelingSidebar vient de prendre (pilule ou panneaux
        // de Prévisualisation), sans rejouer d'entrée ni de mitose. Ces deux props ne sont lues
        // qu'au montage (figées en interne).
        initialPreviewActive={isPreviewActive}
        arrivingFromModeling={arrivingFromModeling}
        leavingToModeling={leavingToModeling}
        previewUpperContent={PreviewPanels.upper(gcodePreview)}
        previewLowerHeader={<GCodeInfoPanel fileInfo={gcodePreview.fileInfo} />}
        previewBelowContent={PreviewPanels.below(gcodePreview, printer.printerAxes)}
        previewLowerContent={PreviewPanels.lower(gcodePreview)}
      />

      <PrinterConfigSidebar
        isOpen={isPrinterConfigOpen}
        onClose={() => setIsPrinterConfigOpen(false)}
        selectedPrinter={printer.selectedPrinter}
        onSelectPrinter={printer.handleSelectPrinter}
        selectedFilament={printer.selectedFilament}
        onSelectFilament={printer.setSelectedFilament}
      />

      {/* Espace Préparation seulement : réglages propres au slicer non-planaire (valeurs envoyées au moteur). */}
      {activeTab === '3d-view' && !isPreviewActive && <EngineSettingsPanel />}

      <SliceSidebar
        onSlice={onSlice}
        previewExport={isPreviewActive ? {
          enabled: gcodePreview.canExport,
          onExport: gcodePreview.exportGCode,
          reason: exportReason(gcodePreview),
        } : undefined}
      />
    </>
  )}
  </>
);

/** Fenêtres et infobulles du plateau (hors Accueil et Paramètres). */
const PlateOverlays: React.FC<{
  isPreviewActive: boolean;
  gcodeName?: string | undefined;
  slice: ReturnType<typeof useSliceFlow>;
}> = ({ isPreviewActive, gcodeName, slice }) => (
    <>
      <ModelStatusBox startsInPreview={isPreviewActive} />
      <ModelHoverTooltip gcodeName={gcodeName} />
      <TextureEditorModal />
      <SliceModal
        isOpen={slice.isSliceModalOpen}
        onClose={() => slice.setIsSliceModalOpen(false)}
        onConfirm={slice.handleConfirmSlice}
      />
      <SlicingProgressModal
        isOpen={slice.isSlicingProgressOpen}
        onClose={() => slice.setIsSlicingProgressOpen(false)}
        onFinished={slice.handleSlicingFinished}
      />
    </>
);

/**
 * l'intérieur du motion.div "apex-3d-chrome" : framer-motion pose transform/will-change sur
 * ses éléments animés, ce qui crée un contexte d'empilement qui piège tout descendant
 * `fixed`, même à `opacity: 1` une fois l'animation d'espace terminée — un z-index local,
 * aussi élevé soit-il, ne peut alors jamais dépasser le rideau de transition (z-index 30),
 * rendu en dehors de ce contexte. Même z-index que les autres panneaux fixes (≥1000, cf.
 * SpaceTransitionOverlay.module.scss) pour rester au-dessus du rideau et ne pas être flouté.
 * Seule la pastille de statut (animée via statusBarRef) se rentre sous le bord de l'écran au
 * changement d'espace : c'est elle qui se trouve dans le coin bas gauche où la barre d'aide
 * vient se poser en Prévisualisation (cf. TopRightMenu). GCodePreviewBar, à droite, a sa PROPRE
 * animation d'entrée/sortie (glissement depuis le bas) et ne doit donc PAS être montée à
 * l'intérieur du conteneur animé par statusBarRef.
 */
const BottomBar: React.FC<{
  modelStatus: ModelStatus | null;
  statusBarRef: React.Ref<HTMLDivElement>;
  isPreviewActive: boolean;
  gcodePreview: GCodePreviewState;
}> = ({ modelStatus, statusBarRef, isPreviewActive, gcodePreview }) => (
      <>
        {/* Pastille de statut en bas à droite : la place qu'occupait le bouton SLICE, parti en haut à droite. */}
        <div className="fixed bottom-3 right-3 z-[1000] flex items-center justify-end pointer-events-none">
          <ModelStatusPill modelStatus={modelStatus} pillRef={statusBarRef} />
        </div>
        <div className="fixed bottom-3 left-3 right-24 z-[1000] flex items-center justify-start gap-3 pointer-events-none">
          <GCodePreviewBar active={isPreviewActive} {...gcodePreview} />
        </div>
      </>
);

/** Zone centrale : le viewport 3D et l'interface du prévisualisateur G-code polaire. */
const ViewportMain: React.FC<{ isPreviewActive: boolean }> = ({ isPreviewActive }) => (
  <main className="flex-1 flex flex-col relative overflow-hidden z-10 bg-transparent">
    <div className="flex-1 w-full h-full">
      <Viewport3D />
    </div>

    {/* Espace Prévisualisation : le tracé lui-même est rendu par Viewport3D, dans la même scène que la
        Préparation. Toujours monté pour conserver le fichier chargé d'un aller-retour à l'autre. */}
    <GCodePreview active={isPreviewActive} />
  </main>
);

const Index = () => {
  const devMode = useDevMode();
  // L'application s'ouvre sur l'Accueil (espace sans 3D) ; le viewport n'est monté qu'en le quittant.
  const [activeTab, setActiveTab] = useState<ActiveTab>('home');
  const [activeCategory, setActiveCategory] = useState<string | null>('quality');
  const [isPrinterConfigOpen, setIsPrinterConfigOpen] = useState(false);
  const printer = usePrinterSelection();
  const { modelStatus, isPreviewActive } = useSpaceEvents();
  const resumeCategory = useResumeCategory(activeCategory, isPreviewActive);
  const isPreviewActiveRef = useRef(isPreviewActive);
  isPreviewActiveRef.current = isPreviewActive;
  // Logique de l'espace Prévisualisation (chargement/lecture G-code) : appelée ici (et non dans
  // GCodePreview) car sa barre de lecture (GCodePreviewBar) partage la rangée du bas avec la
  // pastille de statut du plateau, ce qui demande que les deux soient des enfants directs du même
  // conteneur flex plutôt que des composants positionnés indépendamment.
  const gcodePreview = useGCodePreview(isPreviewActive);
  const morph = useModelingMorphState(activeTab === 'settings');
  const { modelingMorph, setModelingMorph, leavingToModeling, arrivingFromModeling, setArrivingFromModeling } = morph;
  const statusBarRef = useStatusBarSlide(isPreviewActive);
  const slice = useSliceFlow();

  /** L'onglet « Modélisation » de la Sidebar porte la valeur 'settings'. */
  const isModeling = activeTab === 'settings';
  // Au changement d'onglet (rideau refermé) : bascule automatique de la perspective en translation.
  useEffect(() => { setModelingSpace(isModeling); }, [isModeling]);
  // Espace courant, lu par le menu contextuel du viewport (cf. Viewport3D, SPACE_MENU_ITEMS).
  useEffect(() => {
    const space = activeTab === 'home' ? 'home'
      : activeTab === 'settings' ? 'modeling'
      : activeTab === 'developer' ? 'dev'
      : isPreviewActive ? 'preview'
      : 'preparation';
    emitApex('apex-space-changed', { space });
  }, [activeTab, isPreviewActive]);
  // Paramètres et Accueil : le Viewport3D (et tout le reste du chrome sauf la barre d'onglets
  // Sidebar et la barre fichier/son FileSidebar) est entièrement démonté, pas seulement masqué —
  // aucune scène Babylon.js ne doit tourner en fond pendant que ces espaces sont affichés.
  const isParams = activeTab === 'params' || activeTab === 'home';
  const isDev = activeTab === 'developer'; // Dev : seuls viewport, onglets, barre d'aide et avis GPU restent
  const warmingViewport = useViewportWarmup(isParams);

  // Le menu Profils imprimante n'existe que dans Préparation et Prévisualisation (activeTab '3d-view') :
  // il se ferme avec son bouton quand on les quitte.
  useEffect(() => {
    if (activeTab !== '3d-view') setIsPrinterConfigOpen(false);
  }, [activeTab]);

  /**
   * Changement d'onglet (rideau refermé). Passage vers ou hors de Modélisation : le rideau plein écran
   * (déjà déclenché par Sidebar, cf. playSpaceTransition) masque le changement de `main`, pendant lequel
   * ModelingSidebar (montée tant que isModeling || modelingMorph) joue le morph — cf. son prop `morph`.
   */
  const handleTabChange = (tab: string, toPreview?: boolean) => {
    if (tab === 'settings' && !isModeling) {
      // L'état de départ est lu MAINTENANT depuis isPreviewActiveRef, avant que Sidebar ne le fasse
      // passer à jour dans ce même geste.
      setModelingMorph({ direction: 'enter', fromPreview: isPreviewActiveRef.current });
    } else if (tab !== 'settings' && isModeling) {
      // Sortie de Modélisation : `tab === 'box'` vers Préparation comme vers Prévisualisation
      // (`toPreview: true`) — la destination ne peut donc pas se lire depuis `tab` seul.
      setModelingMorph({ direction: 'exit', fromPreview: !!toPreview });
      setArrivingFromModeling(true);
    }
    setActiveTab((tab === 'box' ? '3d-view' : tab) as ActiveTab);
    setIsPrinterConfigOpen(false);
    if (tab === 'params' || tab === 'home') {
      slice.setIsSliceModalOpen(false);
      slice.setIsSlicingProgressOpen(false);
    }
  };

  const panelProps: SpacePanelsProps = {
    activeTab, isModeling, modelingMorph, setModelingMorph, activeCategory, setActiveCategory, resumeCategory,
    isPrinterConfigOpen, setIsPrinterConfigOpen, isPreviewActive, arrivingFromModeling, leavingToModeling,
    gcodePreview, printer, onSlice: slice.handleSlice,
  };

  return (
    <div
      className="flex flex-col h-screen w-screen overflow-hidden select-none relative"
      style={{ backgroundColor: '#33373f' }}
    >
      <DitherOverlay />
      {!isDev && <FileSidebar
        onOpenModel={handleOpenModel}
        onSaveProject={handleSaveProject}
        onOpenSettings={() => setActiveTab('settings')}
        onOpenPrinterConfig={() => {
          setIsPrinterConfigOpen(!isPrinterConfigOpen);
          setActiveCategory(null);
        }}
        showPrinterButton={activeTab === '3d-view'}
        selectedPrinter={printer.selectedPrinter}
        selectedFilament={printer.selectedFilament}
      />}

      {!isParams && !isDev && <PlateOverlays isPreviewActive={isPreviewActive} gcodeName={gcodePreview.fileInfo?.name} slice={slice} />}

      <Sidebar activeTab={activeTab} onTabChange={handleTabChange} onOpenModel={handleOpenModel} />

      {/* Espace Paramètres : tout le chrome lié au plateau 3D (viewport compris) se
          fondu-glisse en une fois plutôt que de disparaître d'un coup — seules la barre
          d'onglets (Sidebar) et la barre fichier/son (FileSidebar) restent visibles. Rendu
          conditionnel simple pour le Viewport3D (jamais monté en Paramètres, cf. CLAUDE.md sur
          Viewport3D) ; AnimatePresence porte uniquement la sortie/entrée visuelle de ce bloc. */}
      <AnimatePresence>
        {!isParams && (
          <motion.div
            key="apex-3d-chrome"
            // Remplit la colonne : sans cela, `main` (flex-1) n'a plus de parent flex, sa hauteur
            // devient celle de son contenu, et le canevas 3D prend la hauteur intrinsèque de son
            // tampon au lieu de celle de la fenêtre (bande vide en bas de l'écran).
            className="flex-1 min-h-0 flex flex-col"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          >
            <TopRightMenu />
            {!isDev && <AxisSidebar />}
            {!isDev && <ViewCube />}

            {!isDev && <SpacePanels {...panelProps} />}

            <ViewportMain isPreviewActive={isPreviewActive} />
          </motion.div>
        )}
      </AnimatePresence>

      {warmingViewport && isParams && (
        <div aria-hidden className="fixed inset-0 pointer-events-none opacity-0 -z-10 overflow-hidden">
          <Viewport3D />
        </div>
      )}

      {activeTab === 'params' && <ParamsPanel />}
      {activeTab === 'home' && <HomePanel />}

      {isDev ? <AmsPanel /> : !isParams && <BottomBar modelStatus={modelStatus} statusBarRef={statusBarRef} isPreviewActive={isPreviewActive} gcodePreview={gcodePreview} />}

      {/* Rideau plein écran commun à tous les changements d'espace (Préparation, Prévisualisation,
          Modélisation, Dev, Paramètres) : monté en permanence, pas seulement à l'intérieur du bloc
          chrome ci-dessus, sinon il disparaîtrait avec lui pendant la transition qu'il est
          justement censé masquer. */}
      <SpaceTransitionOverlay />
      {!devMode && <BetaWatermark />}
      {!devMode && <BetaBanners />}
      <UnlayeredDetectedDialog fileInfo={gcodePreview.fileInfo} loading={gcodePreview.isLoading} active={isPreviewActive} />
    </div>
  );
};

export default Index;
