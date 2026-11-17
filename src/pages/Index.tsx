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
import { Box } from '@/lib/icons';
import { showError, showSuccess, showWarning } from '@/utils/toast';
import { AmsPanel } from '@/components/ams/AmsPanel';
import { markProjectDirty, saveProject } from '@/utils/projectSave';
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
    if (file) {
      markProjectDirty(); // G-code produit : le projet enregistré n'est plus à jour
      emitApex('apex-open-sliced-gcode', { file });
    }
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
  void saveProject().then(
    (saved) => (saved ? showSuccess(`Projet enregistré : ${saved.path}`) : showWarning('Rien à enregistrer.')),
    () => showError("L'enregistrement du projet a échoué."),
  );
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

/** Pastille de statut du plateau (modèle posé, dimensions). */
const ModelStatusPill: React.FC<{ modelStatus: ModelStatus | null }> = ({ modelStatus }) => (
  <div className="shrink-0">
    <div
      data-apex-tooltip={modelStatus
        ? `Modèle « ${modelStatus.name} » posé sur le plateau${modelStatus.dimensions
          ? ` : ${modelStatus.dimensions.x.toFixed(1)} × ${modelStatus.dimensions.z.toFixed(1)} × ${modelStatus.dimensions.y.toFixed(1)} mm`
          : ''}, prêt à être découpé.`
        : "Aucun modèle n'est posé sur le plateau : importez-en un ou déposez un fichier pour commencer."}
      className="bg-[rgba(10,15,26,0.25)] backdrop-blur-[4px] -webkit-backdrop-blur-[4px] border-none rounded-lg px-3 py-2 text-xs text-zinc-300 flex items-center space-x-4 pointer-events-auto shadow-[0_8px_32px_0_rgba(0,0,0,0.4),0_2px_8px_0_rgba(0,0,0,0.3)]"
    >
      {modelStatus ? (
        <div className="flex items-center space-x-4">
          <span className="flex items-center"><Box className="w-3.5 h-3.5 mr-1.5 text-blue-400" /> {modelStatus.name}</span>
          {modelStatus.dimensions && (
            <>
              <span className="text-zinc-600">|</span>
              <span>Dimensions: {modelStatus.dimensions.x.toFixed(1)} x {modelStatus.dimensions.z.toFixed(1)} x {modelStatus.dimensions.y.toFixed(1)} mm</span>
            </>
          )}
          <span className="text-zinc-600">|</span>
          <span className="text-emerald-400 font-medium">Ready to slice</span>
        </div>
      ) : (
        <span className="text-zinc-400">Aucun modèle sur le plateau</span>
      )}
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
 * Rangée du bas : pastille de statut du plateau à droite, barre de lecture du G-code (Prévisualisation) à gauche.
 * Le rideau de transition (z-index 100000) la recouvre : seules les deux barres du haut restent au-dessus.
 */
const BottomBar: React.FC<{
  modelStatus: ModelStatus | null;
  isPreviewActive: boolean;
  gcodePreview: GCodePreviewState;
}> = ({ modelStatus, isPreviewActive, gcodePreview }) => (
      <>
        {/* Pastille de statut en bas à droite : la place qu'occupait le bouton SLICE, parti en haut à droite. */}
        <div className="fixed bottom-3 right-3 z-[1000] flex items-center justify-end pointer-events-none">
          <ModelStatusPill modelStatus={modelStatus} />
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
  // L'application s'ouvre sur l'Accueil (espace sans 3D) ; le viewport n'est monté qu'en le quittant.
  const [activeTab, setActiveTab] = useState<ActiveTab>('home');
  const [activeCategory, setActiveCategory] = useState<string | null>('quality');
  const [isPrinterConfigOpen, setIsPrinterConfigOpen] = useState(false);
  const printer = usePrinterSelection();
  const { modelStatus, isPreviewActive } = useSpaceEvents();
  const resumeCategory = useResumeCategory(activeCategory, isPreviewActive);
  // Dans Préparation, un menu de catégorie (Qualité, Solidité…) est TOUJOURS ouvert : on ne le désélectionne pas.
  // Seuls le menu Profils imprimante (qui prend sa place) et la Prévisualisation (la pilule devient panneaux) le ferment ;
  // il revient aussitôt, sur la dernière catégorie choisie.
  const lastCategoryRef = useRef('quality');
  if (activeCategory) lastCategoryRef.current = activeCategory;
  const isPreviewActiveRef = useRef(isPreviewActive);
  isPreviewActiveRef.current = isPreviewActive;
  // Logique de l'espace Prévisualisation (chargement/lecture G-code) : appelée ici (et non dans
  // GCodePreview) car sa barre de lecture (GCodePreviewBar) partage la rangée du bas avec la
  // pastille de statut du plateau, ce qui demande que les deux soient des enfants directs du même
  // conteneur flex plutôt que des composants positionnés indépendamment.
  const gcodePreview = useGCodePreview(isPreviewActive, activeTab === 'params' || activeTab === 'home');
  const morph = useModelingMorphState(activeTab === 'settings');
  const { modelingMorph, setModelingMorph, leavingToModeling, arrivingFromModeling, setArrivingFromModeling } = morph;
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
    // Lu par le style commun des menus déroulants (styles/_dropdown.scss) : filtre clair dans l'Accueil.
    document.documentElement.dataset.apexSpace = space;
  }, [activeTab, isPreviewActive]);
  // Paramètres et Accueil : le chrome du plateau (Viewport3D compris) reste MONTÉ mais invisible et inerte, et la
  // scène ne se dessine plus. Passer d'un espace à l'autre n'est pas changer de logiciel : au retour, le plateau,
  // les modèles, le G-code, les menus ouverts et la caméra sont exactement comme on les a laissés.
  const isParams = activeTab === 'params' || activeTab === 'home';
  useEffect(() => {
    document.documentElement.dataset.apexSceneHidden = isParams ? '1' : '0';
  }, [isParams]);
  const isDev = activeTab === 'developer'; // Dev : seuls viewport, onglets, barre d'aide et avis GPU restent

  useEffect(() => {
    if (activeTab === '3d-view' && !isPreviewActive && !isPrinterConfigOpen && activeCategory === null) {
      setActiveCategory(lastCategoryRef.current);
    }
  }, [activeTab, isPreviewActive, isPrinterConfigOpen, activeCategory]);

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

      {!isDev && (
        <div className={isParams ? 'contents invisible' : 'contents'}>
          <PlateOverlays isPreviewActive={isPreviewActive} gcodeName={gcodePreview.fileInfo?.name} slice={slice} />
        </div>
      )}

      <Sidebar activeTab={activeTab} onTabChange={handleTabChange} onOpenModel={handleOpenModel} />

      {/* Le changement d'espace est masqué par le rideau (SpaceTransitionOverlay) : aucune animation d'entrée ou de
          sortie ici. Le bloc reste monté en Accueil et Paramètres (invisible, inerte : `invisible` est hérité par
          les panneaux fixes). Il remplit la colonne : sans cela, `main` (flex-1) n'a plus de parent flex, sa hauteur
          devient celle de son contenu, et le canevas 3D prend la hauteur intrinsèque de son tampon au lieu de celle
          de la fenêtre (bande vide en bas de l'écran). */}
      {(
        <div className={isParams ? 'flex-1 min-h-0 flex flex-col invisible pointer-events-none' : 'flex-1 min-h-0 flex flex-col'}>
          <TopRightMenu />
          {!isDev && <AxisSidebar />}
          {/* Espaces 3D seulement : le panneau est porté hors de ce bloc (portail), il ne suit donc pas l'invisibilité d'Accueil / Paramètres. */}
          {!isDev && !isParams && <ViewCube />}

          {!isDev && <SpacePanels {...panelProps} />}

          <ViewportMain isPreviewActive={isPreviewActive} />
        </div>
      )}

      {activeTab === 'params' && <ParamsPanel />}
      {activeTab === 'home' && <HomePanel />}

      {isDev ? <AmsPanel /> : (
        <div className={isParams ? 'contents invisible' : 'contents'}>
          <BottomBar modelStatus={modelStatus} isPreviewActive={isPreviewActive} gcodePreview={gcodePreview} />
        </div>
      )}

      {/* Rideau plein écran commun à tous les changements d'espace (Préparation, Prévisualisation,
          Modélisation, Dev, Paramètres) : monté en permanence, pas seulement à l'intérieur du bloc
          chrome ci-dessus, sinon il disparaîtrait avec lui pendant la transition qu'il est
          justement censé masquer. */}
      <SpaceTransitionOverlay />
      <UnlayeredDetectedDialog fileInfo={gcodePreview.fileInfo} loading={gcodePreview.isLoading} active={isPreviewActive} />
    </div>
  );
};

export default Index;
