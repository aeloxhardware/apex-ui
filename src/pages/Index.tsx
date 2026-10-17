"use client";

import React, { useEffect, useRef, useState } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { FileSidebar } from '@/components/FileSidebar';
import { SliceSidebar } from '@/components/SliceSidebar';
import { CategoriesSidebar } from '@/components/CategoriesSidebar';
import { PrinterConfigSidebar } from '@/components/PrinterConfigSidebar';
import { AxisSidebar } from '@/components/AxisSidebar';
import { ModelingSidebar } from '@/components/ModelingSidebar';
import { TopRightMenu } from '@/components/TopRightMenu';
import { ModelStatusBox } from '@/components/ModelStatusBox';
import { ModelHoverTooltip } from '@/components/ModelHoverTooltip';
import { TextureEditorModal } from '@/components/TextureEditorModal';
import { SliceModal } from '@/components/SliceModal';
import { SlicingProgressModal } from '@/components/SlicingProgressModal';
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
import { useAnimate, motion, AnimatePresence } from 'framer-motion';
import { Box } from 'lucide-react';
import { showSuccess } from '@/utils/toast';
import { AlphaWatermark } from '@/components/AlphaWatermark';
import { useDevMode } from '@/utils/devModePrefs';

interface ModelStatus {
  name: string;
  dimensions: { x: number; y: number; z: number } | null;
}

const Index = () => {
  const devMode = useDevMode();
  // L'application s'ouvre sur l'Accueil (espace sans 3D) ; le viewport n'est monté qu'en le quittant.
  const [activeTab, setActiveTab] = useState<'3d-view' | 'settings' | 'developer' | 'params' | 'home'>('home');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [isPrinterConfigOpen, setIsPrinterConfigOpen] = useState(false);
  const [selectedPrinter, setSelectedPrinter] = useState('Prusa MK4');
  const [selectedFilament, setSelectedFilament] = useState('PLA Premium (eSUN / Prusament)');
  const [isSliceModalOpen, setIsSliceModalOpen] = useState(false);
  const [isSlicingProgressOpen, setIsSlicingProgressOpen] = useState(false);
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null);
  const [isPreviewActive, setIsPreviewActive] = useState(false);
  const isPreviewActiveRef = useRef(isPreviewActive);
  isPreviewActiveRef.current = isPreviewActive;
  // Logique de l'espace Prévisualisation (chargement/lecture G-code) : appelée ici (et non dans
  // GCodePreview) car sa barre de lecture (GCodePreviewBar) partage la rangée du bas avec la
  // pastille de statut du plateau, ce qui demande que les deux soient des enfants directs du même
  // conteneur flex plutôt que des composants positionnés indépendamment.
  const gcodePreview = useGCodePreview(isPreviewActive);
  // Le temps que ModelingSidebar déforme sa propre silhouette entre la forme de la pilule/des deux
  // panneaux de Prévisualisation et sa forme normale — cf. le commentaire sur `onTabChange` plus
  // bas et le prop `morph` de ModelingSidebar. `null` = pas de morph en cours ; sinon, `direction`
  // indique le sens ('enter' : la pilule/Prévisualisation devient le panneau Modélisation, 'exit' :
  // l'inverse) et `fromPreview` l'état de Prévisualisation à l'autre bout du morph (pilule ou
  // panneaux Preview) — figé à l'instant du clic, lu depuis isPreviewActiveRef, PAS depuis
  // isPreviewActive : Sidebar mute ce dernier dans le même geste, avant qu'on ait la chance de lire
  // sa valeur de départ. Contrairement à l'ancienne approche (deux calques à synchroniser — un
  // verre animé séparé, puis le vrai panneau), c'est ICI le même élément, déjà affiché avec son
  // contenu réel, qui change de forme : plus de raccord entre deux éléments distincts, donc plus
  // de risque de clignotement à la jonction.
  const [modelingMorph, setModelingMorph] = useState<{ direction: 'enter' | 'exit'; fromPreview: boolean } | null>(null);
  // Vrai dès le CLIC vers Modélisation (cf. l'écouteur d'apex-entering-modeling plus bas), jamais
  // seulement à `onCovered` (~900ms plus tard, une fois le rideau refermé) : le fondu-glissement du
  // panneau du bas de Prévisualisation doit être visible EN TRANSPARENCE À TRAVERS le rideau qui
  // monte, pas caché derrière lui — contrairement au vrai changement d'onglet (`onTabChange`), qui
  // lui reste cadencé par `onCovered`. Redevient faux une fois le morph 'enter' effectivement lancé
  // (le panneau du bas a alors largement eu le temps de finir sa disparition, 260ms contre les
  // ~900ms d'attente du rideau).
  const [leavingToModeling, setLeavingToModeling] = useState(false);
  const [statusBarRef, animateStatusBar] = useAnimate<HTMLDivElement>();
  const prevPreviewActiveRef = useRef(isPreviewActive);

  // Au changement d'espace, la barre d'aide (TopRightMenu) passe par le coin bas gauche, là où
  // se trouve la barre de statut : celle-ci se rentre sous le bord de l'écran juste avant
  // (0,2 → 0,45 s ; la barre d'aide démarre à 0,495 s) et ressort une fois la barre d'aide
  // arrivée (1,1 s), pour ne pas se faire recouvrir.
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

  /** L'onglet « Modélisation » de la Sidebar porte la valeur 'settings'. */
  const isModeling = activeTab === 'settings';
  // Espace Paramètres : le Viewport3D (et tout le reste du chrome sauf la barre d'onglets
  // Sidebar et la barre fichier/son FileSidebar) est entièrement démonté, pas seulement masqué —
  // aucune scène Babylon.js ne doit tourner en fond pendant que cet espace est affiché.
  // Paramètres et Accueil : mêmes espaces sans 3D.
  const isParams = activeTab === 'params' || activeTab === 'home';

  // Préchargement (interface moderne) : l'application s'ouvre sur l'Accueil, sans 3D. Un Viewport3D invisible
  // est monté au lancement, le temps que son moteur, ses shaders et ses modèles soient prêts (le splash
  // l'attend, cf. main.tsx), puis démonté : aucune scène ne tourne en fond (cf. commentaire ci-dessus).
  // Le premier passage en 3D retrouve ainsi des caches chauds au lieu de tout initialiser.
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

  // Le menu Profils imprimante n'existe que dans Préparation et Prévisualisation (activeTab '3d-view') :
  // il se ferme avec son bouton quand on les quitte.
  useEffect(() => {
    if (activeTab !== '3d-view') setIsPrinterConfigOpen(false);
  }, [activeTab]);

  // Une fois CategoriesSidebar (et son panneau du bas) effectivement démontée par le passage en
  // Modélisation, `leavingToModeling` peut redescendre : il n'a plus d'effet visuel à cet instant
  // (le fondu est terminé depuis longtemps), mais doit être prêt (`false`) pour un futur cycle.
  useEffect(() => {
    if (isModeling) setLeavingToModeling(false);
  }, [isModeling]);

  // Vrai du début d'un morph de sortie de Modélisation jusqu'au commit qui le termine, où
  // CategoriesSidebar est remontée et le lit (une seule fois, à son montage). Remis à `false` juste
  // après, une fois ce montage passé.
  const [arrivingFromModeling, setArrivingFromModeling] = useState(false);
  useEffect(() => {
    if (!modelingMorph) setArrivingFromModeling(false);
  }, [modelingMorph]);

  React.useEffect(() => {
    const handleModelSelected = (event: CustomEvent<{
      name: string | null;
      dimensions?: { x: number; y: number; z: number };
    }>) => {
      if (!event.detail?.name) {
        setModelStatus(null);
        return;
      }

      setModelStatus({
        name: event.detail.name,
        dimensions: event.detail.dimensions ?? null,
      });
    };

    const handleModelImported = (event: CustomEvent<File>) => {
      if (event.detail?.name) {
        setModelStatus({ name: event.detail.name, dimensions: null });
      }
    };

    const handlePreviewToggled = (event: CustomEvent<{ active: boolean }>) => {
      setIsPreviewActive(!!event.detail?.active);
    };

    // Dispatché par Sidebar.tsx (handleTopTabClick) au tout début du clic vers Modélisation, avant
    // même que le rideau plein écran ne commence à monter — cf. le commentaire sur
    // `leavingToModeling` plus haut.
    const handleEnteringModeling = () => setLeavingToModeling(true);

    window.addEventListener('apex-mesh-selected', handleModelSelected as EventListener);
    window.addEventListener('apex-import-model', handleModelImported as EventListener);
    window.addEventListener('apex-preview-toggled', handlePreviewToggled as EventListener);
    window.addEventListener('apex-entering-modeling', handleEnteringModeling);

    return () => {
      window.removeEventListener('apex-mesh-selected', handleModelSelected as EventListener);
      window.removeEventListener('apex-import-model', handleModelImported as EventListener);
      window.removeEventListener('apex-preview-toggled', handlePreviewToggled as EventListener);
      window.removeEventListener('apex-entering-modeling', handleEnteringModeling);
    };
  }, []);

  const handleSlice = () => {
    window.dispatchEvent(new CustomEvent('apex-request-slice-models'));
    setIsSliceModalOpen(true);
  };

  const handleConfirmSlice = () => {
    window.dispatchEvent(new CustomEvent('apex-slice-all-models'));
    setIsSliceModalOpen(false);
    setIsSlicingProgressOpen(true);
    showSuccess('Découpage du plateau démarré...');
  };

  const handleSlicingFinished = () => {
    setIsSlicingProgressOpen(false);
    showSuccess("Slicing plate completed successfully!");
  };

  const handleOpenModel = () => {
    showSuccess("Select an STL or GLB file to add a model.");
  };

  const handleSaveProject = () => {
    showSuccess("Project saved successfully.");
  };

  return (
    <div
      className="flex flex-col h-screen w-screen overflow-hidden select-none relative"
      style={{ backgroundColor: '#2a2d34' }}
    >
      <DitherOverlay />
      <FileSidebar 
        onOpenModel={handleOpenModel}
        onSaveProject={handleSaveProject}
        onOpenSettings={() => setActiveTab('settings')}
        onOpenPrinterConfig={() => {
          setIsPrinterConfigOpen(!isPrinterConfigOpen);
          setActiveCategory(null);
        }}
        showPrinterButton={activeTab === '3d-view'}
        selectedPrinter={selectedPrinter}
        selectedFilament={selectedFilament}
      />

      {!isParams && (
        <>
          <ModelStatusBox startsInPreview={isPreviewActive} />
          <ModelHoverTooltip />
          <TextureEditorModal />
          <SliceModal
            isOpen={isSliceModalOpen}
            onClose={() => setIsSliceModalOpen(false)}
            onConfirm={handleConfirmSlice}
          />
          <SlicingProgressModal
            isOpen={isSlicingProgressOpen}
            onClose={() => setIsSlicingProgressOpen(false)}
            onFinished={handleSlicingFinished}
          />
        </>
      )}

      <Sidebar
        activeTab={activeTab}
        onTabChange={(tab, toPreview) => {
          // Passage vers ou hors de Modélisation : le rideau plein écran (déjà déclenché par
          // Sidebar avant cet appel, cf. playSpaceTransition) masque le changement de `main`,
          // pendant lequel ModelingSidebar (montée en permanence tant que isModeling ||
          // modelingMorph) joue le morph — cf. son prop `morph`.
          if (tab === 'settings' && !isModeling) {
            // L'état de départ (Préparation ou Prévisualisation) est lu MAINTENANT depuis
            // isPreviewActiveRef, avant que Sidebar ne le fasse passer à jour dans ce même geste.
            // Les éléments sans place en Modélisation ont déjà disparu depuis le clic
            // (apex-entering-modeling, ~900ms plus tôt) : la déformation peut commencer tout de
            // suite, dans le même commit que la bascule CategoriesSidebar → ModelingSidebar.
            setModelingMorph({ direction: 'enter', fromPreview: isPreviewActiveRef.current });
          } else if (tab !== 'settings' && isModeling) {
            // Sortie de Modélisation : `tab === 'box'` que ce soit vers Préparation ou vers
            // Prévisualisation (cf. handleLayerClick dans Sidebar.tsx, branche `entering`, qui
            // passe `toPreview: true`) — la destination ne peut donc pas se lire depuis `tab` seul.
            setModelingMorph({ direction: 'exit', fromPreview: !!toPreview });
            setArrivingFromModeling(true);
          }
          setActiveTab(tab === 'box' ? '3d-view' : tab);
          setIsPrinterConfigOpen(false);
          if (tab === 'params' || tab === 'home') {
            setIsSliceModalOpen(false);
            setIsSlicingProgressOpen(false);
          }
        }}
        onOpenModel={handleOpenModel}
      />

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
            <AxisSidebar />
            <ViewCube />

            {/* Les panneaux slicer et le panneau modélisation s'excluent mutuellement. La bascule se fait
                TOUJOURS dans un seul commit, par un rendu conditionnel simple — jamais via
                AnimatePresence, qui retarde le démontage de l'ancien côté (et en mode 'wait', le
                montage du nouveau) d'au moins une tâche, donc d'au moins une frame peinte. Toute
                l'animation visible est portée ailleurs : la déformation par ModelingSidebar (prop
                `morph`), les fondus par `animate` dès le clic. */}
            {isModeling || modelingMorph?.direction === 'exit' ? (
              <ModelingSidebar
                morph={
                  modelingMorph
                    ? { ...modelingMorph, onDone: () => setModelingMorph(null) }
                    : undefined
                }
              />
            ) : (
                <>
                  <CategoriesSidebar
                    activeCategory={activeCategory}
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
                    previewUpperContent={
                      <PreviewUpperTabs coloration={
                      <GCodeLineTypeLegend
                        fileInfo={gcodePreview.fileInfo}
                        visibility={gcodePreview.lineVisibility}
                        onToggle={gcodePreview.setLineVisible}
                        colorBy={gcodePreview.colorBy}
                        setColorBy={gcodePreview.setColorBy}
                        activeColorByScope={gcodePreview.activeColorByScope}
                        setColorByScope={gcodePreview.setColorByScope}
                        renderPrecisionBounds={gcodePreview.renderPrecisionBounds}
                        activeRenderPrecisionMm={gcodePreview.activeRenderPrecisionMm}
                        setRenderPrecision={gcodePreview.setRenderPrecision}
                        pickingPoint={gcodePreview.isPickingPoint}
                        onTogglePickPoint={gcodePreview.togglePickPoint}
                      />
                      } />
                    }
                    previewLowerHeader={<GCodeInfoPanel fileInfo={gcodePreview.fileInfo} />}
                    previewBelowContent={
                      <GCodeConversionCard
                        source={gcodePreview.conversionSource}
                        conversion={gcodePreview.conversion}
                        onConvert={gcodePreview.convert}
                        onHighlightOffPlate={gcodePreview.setOffPlateHighlight}
                        available={gcodePreview.conversionAvailable}
                      />
                    }
                    previewLowerContent={
                      <GCodeSpeedSelector
                        speed={gcodePreview.speed}
                        setSpeed={gcodePreview.setSpeed}
                        showFullHead={gcodePreview.showFullHead}
                        setShowFullHead={gcodePreview.setShowFullHead}
                      />
                    }
                  />

                  <PrinterConfigSidebar
                    isOpen={isPrinterConfigOpen}
                    onClose={() => setIsPrinterConfigOpen(false)}
                    selectedPrinter={selectedPrinter}
                    onSelectPrinter={setSelectedPrinter}
                    selectedFilament={selectedFilament}
                    onSelectFilament={setSelectedFilament}
                  />

                  <SliceSidebar
                    onSlice={handleSlice}
                    previewExport={isPreviewActive ? {
                      enabled: gcodePreview.canExport,
                      onExport: gcodePreview.exportGCode,
                      reason: !gcodePreview.fileInfo
                        ? 'Chargez un G-code pour pouvoir l’exporter.'
                        : gcodePreview.conversion.status === 'running'
                          ? 'Conversion en cours…'
                          : "Convertissez d'abord le G-code 3 axes en polaire (carte Conversion, sous les panneaux).",
                    } : undefined}
                  />
                </>
            )}

            <main className="flex-1 flex flex-col relative overflow-hidden z-10 bg-transparent">
              <div className="flex-1 w-full h-full">
                <Viewport3D />
              </div>

              {/* Espace Prévisualisation : interface du prévisualisateur G-code polaire. Le tracé
                  lui-même est rendu par Viewport3D, dans la même scène que la Préparation. Toujours
                  monté pour conserver le fichier chargé d'un aller-retour à l'autre. */}
              <GCodePreview active={isPreviewActive} />
            </main>
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

      {/* Bottom status / stats overlay — monté au niveau racine (comme ModelStatusBox), PAS à
          l'intérieur du motion.div "apex-3d-chrome" : framer-motion pose transform/will-change sur
          ses éléments animés, ce qui crée un contexte d'empilement qui piège tout descendant
          `fixed`, même à `opacity: 1` une fois l'animation d'espace terminée — un z-index local,
          aussi élevé soit-il, ne peut alors jamais dépasser le rideau de transition (z-index 30),
          rendu en dehors de ce contexte. Même z-index que les autres panneaux fixes (≥1000, cf.
          SpaceTransitionOverlay.module.scss) pour rester au-dessus du rideau et ne pas être flouté.
          Seule la pastille de statut (premier enfant, animé via statusBarRef) se rentre sous le
          bord de l'écran au changement d'espace : c'est elle qui se trouve dans le coin bas gauche
          où la barre d'aide vient se poser en Prévisualisation (cf. TopRightMenu). GCodePreviewBar,
          à droite, a sa PROPRE animation d'entrée/sortie (glissement depuis le bas) et ne doit donc
          PAS être montée à l'intérieur du conteneur animé par statusBarRef, sous peine d'hériter de
          son va-et-vient et de sembler apparaître puis disparaître avec la pastille dans une seule
          et même animation. */}
      {!isParams && (
        <div className="fixed bottom-3 left-6 right-24 z-[1000] flex items-center justify-start gap-3 pointer-events-none">
          <div ref={statusBarRef} className="shrink-0">
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

          <GCodePreviewBar active={isPreviewActive} {...gcodePreview} />
        </div>
      )}

      {/* Rideau plein écran commun à tous les changements d'espace (Préparation, Prévisualisation,
          Modélisation, Dev, Paramètres) : monté en permanence, pas seulement à l'intérieur du bloc
          chrome ci-dessus, sinon il disparaîtrait avec lui pendant la transition qu'il est
          justement censé masquer. */}
      <SpaceTransitionOverlay />
      {!devMode && <AlphaWatermark />}
      <UnlayeredDetectedDialog fileInfo={gcodePreview.fileInfo} loading={gcodePreview.isLoading} active={isPreviewActive} />
    </div>
  );
};

export default Index;