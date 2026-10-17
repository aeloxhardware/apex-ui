import React, { useState, useRef, useEffect } from 'react';
import { motion, Variants } from 'framer-motion';
import clsx from 'clsx';
import {
  FileSliders,
  Box,
  MousePointer2,
  Move3d,
  RotateCw,
  Maximize,
  Upload,
  Code,
  Maximize2,
  Eye,
  Palette,
  Layers,
  Settings
} from 'lucide-react';
import { LOGO_PAD_X, LOGO_PAD_Y, PILL_CLIP, TRIANGLE_CLIP } from '@/utils/indicatorShapes';
import styles from './Sidebar.module.scss';
import { CustomTooltip } from './CustomTooltip';
import { PREVIEW_TABS, getPreviewTab, setPreviewTab, usePreviewTab } from './PreviewUpperTabs';
import { playUiSound, type UiSoundName } from '@/utils/uiSound';
import { GCODE_FILE_EXT } from '@/hooks/use-gcode-preview';
import { showSuccess } from '@/utils/toast';
import { APP_TAGLINE_DEV, APP_TAGLINE_PREVIEW, isDevModeEnabled, subscribeDevMode } from '@/utils/devModePrefs';
import { getStartPage } from '@/utils/startPagePrefs';

// Doit correspondre à ViewCube.module.scss (`.container`) : la colonne d'outils du mode
// Prévisualisation vient se coller au même bord droit, juste sous le gizmo.
const VIEWCUBE_RIGHT = 24;
const VIEWCUBE_BOTTOM = 70 + 130; // top + height
const PREVIEW_TOOLBAR_TOP_GAP = 10; // marge entre le bas du ViewCube et le haut de la colonne
const PREVIEW_TOOLBAR_WIDTH = 56; // largeur de la colonne de calques en mode Prévisualisation

// Position de repos (mode box, sans transformation) du haut de `.bottomToolbar` : top du
// `.container` (20px) + hauteur du `.topToolbar` (42px de bouton + 8px de padding de
// chaque côté = 58px) + le gap de la pile flex (10px). Doit rester en phase avec
// Sidebar.module.scss si ces valeurs changent.
const BOTTOM_TOOLBAR_REST_TOP = 20 + 58 + 10;

// Durée totale de l'animation de déplacement/déformation du conteneur `.bottomToolbar`
// (voir son `transition` plus bas) : c'est le délai avant lequel les icônes du mode cible
// ne doivent JAMAIS commencer à apparaître (cf. `iconVariants.visible`), dans tous les sens
// de transition. Partagée par les deux pour qu'elles ne puissent pas diverger.
const CONTAINER_RESHAPE_DURATION = 1.1;

interface SidebarProps {
  activeTab: '3d-view' | 'settings' | 'developer' | 'params' | 'home';
  /**
   * `toPreview` n'est vrai que pour l'unique cas où `tab === 'box'` signifie « vers
   * Prévisualisation » plutôt que « vers Préparation » (cf. handleLayerClick, branche `entering`) —
   * Index.tsx en a besoin pour savoir, en sortant de Modélisation, vers quelle forme (pilule ou
   * panneaux de Prévisualisation) jouer le morph.
   */
  onTabChange: (tab: 'box' | 'settings' | 'developer' | 'params' | 'home', toPreview?: boolean) => void;
  onOpenModel?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onTabChange,
  onOpenModel
}) => {
  const [activeTool, setActiveTool] = useState<'select' | 'move' | 'rotate' | 'scale' | 'texture' | 'layers'>('select');
  const [isPreviewActive, setIsPreviewActive] = useState(false);
  const previewTab = usePreviewTab();
  const [devMode, setDevModeState] = useState(isDevModeEnabled);
  useEffect(() => subscribeDevMode(setDevModeState), []);
  // Désactiver le mode dev depuis un espace devenu caché (Dev, Modélisation) ramène à l'Accueil ;
  // l'onglet « Fonction » grisé ne doit pas rester affiché.
  useEffect(() => {
    if (devMode) return;
    if (activeTab === 'developer' || activeTab === 'settings') onTabChange('home');
    if (getPreviewTab() === 'fonction') setPreviewTab('coloration');
  }, [devMode, activeTab, onTabChange]);
  // Géométrie du conteneur juste avant de lancer la transition en cours : mesurée à la volée
  // (voir `playSpaceTransition`) quel que soit le mode de départ (slicer, prévisualisation
  // ou modélisation), pour que l'animation de conteneur parte toujours de sa forme réelle et
  // non d'une valeur figée valable pour un seul sens de transition.
  const [fromGeometry, setFromGeometry] = useState<{ x: number; y: number; width: number; height: number; borderRadius: number } | null>(null);
  // Largeur naturelle de la barre slicer (mode "box") : son contenu (8 boutons + 2
  // séparateurs) ne change jamais, donc une mesure une fois montée suffit — c'est la valeur
  // cible numérique vers laquelle animer au retour au mode slicer (une keyframe `"auto"`
  // mélangée à des nombres dans le même tableau n'anime pas correctement avec framer-motion).
  const [boxWidth, setBoxWidth] = useState<number | null>(null);
  // Décalage horizontal (en x) à appliquer en mode Prévisualisation pour que la colonne
  // d'outils vienne se coller au bord droit de l'écran, juste sous le gizmo ViewCube
  // (position fixe à `right: 24px`, voir ViewCube.module.scss) — recalculé au resize car
  // `.bottomToolbar` est centré par le flex column de `.container` (`left: 50%`), donc son
  // décalage nécessaire dépend de la largeur de la fenêtre.
  const [previewX, setPreviewX] = useState(0);
  // Décalage vertical (en y) additionnel en mode Prévisualisation, calculé pour amener le
  // haut de la colonne juste sous le ViewCube, quelle que soit sa position de repos réelle
  // (dépend de la hauteur du bandeau d'onglets du haut).
  const [previewY, setPreviewY] = useState(0);
  const bottomToolbarRef = useRef<HTMLDivElement>(null);
  // Géométrie de repos courante, relue par les écouteurs montés une seule fois.
  const targetGeometryRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const topToolbarRef = useRef<HTMLDivElement>(null);
  // Slot où ModelingSidebar injecte ses boutons CAD via un portail (id stable plutôt qu'un
  // ref transmis en prop : les deux composants sont des siblings montés indépendamment dans
  // Index.tsx, un id DOM est la façon la plus simple de se retrouver).
  const modelingSlotRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [indicatorStyle, setIndicatorStyle] = React.useState<React.CSSProperties>({});
  // Sur le logo (Accueil), le surlignage devient un triangle aux bords arrondis (cf. utils/indicatorShapes.ts).
  const [indicatorOnLogo, setIndicatorOnLogo] = React.useState(false);

  /** L'onglet « Modélisation » porte la valeur 'settings'. */
  const isModeling = activeTab === 'settings';
  // Outil Esquisse actif (annoncé par ModelingSidebar) : la barre CAD ne garde que son bouton.
  const [modelingSketchActive, setModelingSketchActive] = useState(false);
  // Sens du redimensionnement de la barre CAD (Esquisse actif / terminé) : change le séquencement.
  const [sketchReshape, setSketchReshape] = useState<'in' | 'out' | null>(null);
  /** L'onglet « Paramètres » porte la valeur 'params' : le viewport et ses outils n'ont plus
   * de sens dans cet espace, cf. le fondu-glissement sur `.bottomToolbar` plus bas. */
  const isParams = activeTab === 'params' || activeTab === 'home';

  useEffect(() => {
    const onSketchActive = (e: Event) => {
      const active = !!(e as CustomEvent<{ active: boolean }>).detail?.active;
      // Le redimensionnement part de la largeur RÉELLEMENT affichée (sinon il repartirait de la
      // dernière géométrie d'une transition d'espace, d'où un saut).
      const el = bottomToolbarRef.current;
      if (el) {
        const rect = el.getBoundingClientRect();
        setFromGeometry({
          x: targetGeometryRef.current.x,
          y: targetGeometryRef.current.y,
          width: rect.width,
          height: rect.height,
          borderRadius: parseFloat(getComputedStyle(el).borderTopLeftRadius) || 14,
        });
      }
      setSketchReshape(active ? 'in' : 'out');
      setModelingSketchActive(active);
    };
    window.addEventListener('apex-modeling-sketch-active', onSketchActive);
    return () => window.removeEventListener('apex-modeling-sketch-active', onSketchActive);
  }, []);

  // Gabarit cible du conteneur commun pour chaque mode — voir le commentaire au-dessus de
  // `.bottomToolbar` dans le JSX pour la logique d'animation qui s'en sert. En mode
  // Prévisualisation, x/y viennent coller la colonne au bord droit de l'écran juste sous le
  // ViewCube (voir l'effet qui calcule `previewX`/`previewY` plus haut) plutôt qu'un
  // décalage fixe indépendant de la largeur de la fenêtre.
  const targetGeometry = isModeling
    ? { x: 0, y: 0, width: modelingSketchActive ? 50 : 274, height: 50, borderRadius: 14 } // barre CAD (6 boutons de 38px + séparateur) ; Esquisse seul : 1 bouton
    : isPreviewActive
      ? { x: previewX, y: previewY, width: PREVIEW_TOOLBAR_WIDTH, height: 340, borderRadius: 20 } // colonne de calques
      : { x: 0, y: 0, width: boxWidth ?? 332, height: 44, borderRadius: 22 }; // barre slicer

  targetGeometryRef.current = { x: targetGeometry.x, y: targetGeometry.y };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const SPACE_LABELS: Record<'box' | 'settings' | 'developer' | 'layers' | 'params' | 'home', string> = {
    home: 'Accueil',
    box: 'Préparation',
    settings: 'Modélisation',
    developer: 'Dev',
    layers: 'Prévisualisation',
    params: 'Paramètres',
  };

  // Son propre à l'espace d'arrivée. Pas de son pour la console Dev ni pour les Paramètres.
  const SPACE_SOUNDS: Record<'box' | 'settings' | 'developer' | 'layers' | 'params' | 'home', UiSoundName | null> = {
    home: null,
    box: 'spacePreparation',
    settings: 'spaceModeling',
    developer: null,
    layers: 'spacePreview',
    params: null,
  };

  /**
   * Joue le rideau "APEX / <espace>" (voir SpaceTransitionOverlay) puis exécute `onCovered`
   * une fois l'écran masqué — c'est là, et pas avant, que le vrai changement d'onglet doit
   * avoir lieu pour ne jamais être visible pendant la transition. Mesure aussi la forme
   * actuelle du conteneur d'outils juste avant : quel que soit le mode de départ (slicer,
   * prévisualisation ou modélisation), c'est de là que doit partir l'animation de
   * déformation vers le mode suivant — jamais une valeur figée valable pour un seul sens.
   */
  const playSpaceTransition = (space: keyof typeof SPACE_LABELS, onCovered: () => void) => {
    const label = SPACE_LABELS[space];
    const sound = SPACE_SOUNDS[space];
    if (sound) playUiSound(sound);
    if (bottomToolbarRef.current) {
      const rect = bottomToolbarRef.current.getBoundingClientRect();
      const computedRadius = parseFloat(getComputedStyle(bottomToolbarRef.current).borderTopLeftRadius) || 22;
      // `x`/`y` ne sont pas lisibles depuis le DOM (ce sont des translate posés par
      // framer-motion, pas une position absolue) : on reprend ceux du mode qu'on est en
      // train de quitter, calculés par la même table que `targetGeometry` ci-dessous.
      setFromGeometry({
        x: targetGeometry.x,
        y: targetGeometry.y,
        width: rect.width,
        height: rect.height,
        borderRadius: computedRadius,
      });
      setSketchReshape(null); // transition d'espace : séquencement normal de la barre
    }
    window.dispatchEvent(new CustomEvent('apex-space-transition', {
      detail: {
        label,
        onCovered: () => {
          onCovered();
          showSuccess(`Espace ${label} activé.`);
        },
      },
    }));
  };

  const handleTopTabClick = (tabName: 'box' | 'settings' | 'developer' | 'params' | 'home') => {
    if (tabName === 'settings' && !isModeling) {
      // Signale DÈS LE CLIC — avant même que le rideau plein écran ne commence à monter, pas
      // seulement une fois l'écran couvert (`onCovered`, ~900ms plus tard) — que les éléments sans
      // place dans l'espace Modélisation (ModelStatusBox, panneau du bas de Prévisualisation)
      // doivent commencer à disparaître : ce fondu-glissement doit être visible EN TRANSPARENCE À
      // TRAVERS le rideau (z-index 1000+ pour ces éléments, contre 30 pour le rideau), jamais
      // caché derrière lui comme le vrai changement d'onglet (`onTabChange`, lui, reste dans
      // `onCovered` ci-dessous : le panneau Modélisation ne doit apparaître qu'une fois l'écran
      // couvert).
      window.dispatchEvent(new CustomEvent('apex-entering-modeling'));
    } else if (tabName !== 'settings' && isModeling) {
      // Symétrique : le contenu du panneau Modélisation disparaît en cascade dès le clic, avant
      // que sa forme ne commence à se déformer (à `onCovered`, cf. ModelingSidebar).
      window.dispatchEvent(new CustomEvent('apex-leaving-modeling'));
    }
    const loadingModeling = tabName === 'settings' && !isModeling;
    playSpaceTransition(tabName, () => {
      setActiveTool('select');
      onTabChange(tabName);
      setIsPreviewActive(false);
      window.dispatchEvent(new CustomEvent('apex-preview-toggled', { detail: { active: false } }));
    });
    // Modélisation : le rideau reste jusqu'à ce que la scène soit réellement prête (Viewport3D
    // relâche `apex-gcode-loading` après `apex-mode-changed`), pas pour une durée fixe. Garde-fou
    // à 8 s si le signal n'arrive jamais.
    if (loadingModeling) {
      window.dispatchEvent(new CustomEvent('apex-gcode-loading', { detail: { active: true, label: 'Modélisation' } }));
      window.setTimeout(
        () => window.dispatchEvent(new CustomEvent('apex-gcode-loading', { detail: { active: false } })),
        8000,
      );
    }
  };

  const TOOL_LABELS: Record<'select' | 'move' | 'rotate' | 'scale' | 'texture' | 'layers', string> = {
    select: 'Sélection',
    move: 'Déplacement',
    rotate: 'Rotation',
    scale: 'Échelle',
    texture: 'Texture',
    layers: 'Prévisualisation',
  };
  const announceTool = (tool: keyof typeof TOOL_LABELS) => {
    showSuccess(`Outil ${TOOL_LABELS[tool]} activé.`);
  };

  const handleToolClick = (tool: 'select' | 'move' | 'rotate' | 'scale' | 'texture') => {
    const newTool = activeTool === tool ? 'select' : tool;
    setActiveTool(newTool);
    window.dispatchEvent(new CustomEvent('apex-tool-changed', { detail: { tool: newTool } }));
    announceTool(newTool);
  };

  /**
   * Bascule animée vers l'espace Prévisualisation (rideau + déformation de la pilule), factorisée
   * hors de `handleLayerClick` pour être aussi déclenchée par le dépôt d'un fichier G-code en
   * Préparation (cf. l'écouteur `drop` plus bas) — même geste que le clic sur l'icône Prévisualisation,
   * simplement déclenché autrement. `pendingFile`, s'il est fourni, est réémis (`apex-gcode-loaded`
   * en pointillé via `apex-entering-preview-with-file`) une fois l'écran couvert, PAS avant : au
   * moment du dépôt, l'espace Prévisualisation n'a pas encore son hook de lecture actif
   * (`useGCodePreview(isPreviewActive)` dans Index.tsx), lequel n'écoute le dépôt/chargement que
   * lorsque `active` — le charger avant ce basculement n'aurait donc aucun effet.
   */
  const enterPreview = (pendingFile?: File) => {
    // Depuis Modélisation : même signal au clic que handleTopTabClick (cf. apex-leaving-modeling).
    if (isModeling) window.dispatchEvent(new CustomEvent('apex-leaving-modeling'));
    // Depuis Préparation : la boîte des modèles et les icônes de la pilule disparaissent dès le
    // clic, avant que la pilule ne commence à se déformer (sous le rideau, à `onCovered`).
    else window.dispatchEvent(new CustomEvent('apex-entering-preview'));
    // L'ancien fondu séquencé des panneaux (avant le rideau plein écran) n'a plus de raison
    // d'être : le rideau masque déjà tout pendant que ce switch se produit, donc tout bascule
    // d'un coup sous le voile plutôt qu'en deux temps visibles.
    playSpaceTransition('layers', () => {
      setActiveTool('layers');
      // Prévisualisation est un sous-mode du slicer (Préparation), jamais de la
      // Modélisation : sans ce `onTabChange`, entrer en Prévisualisation depuis
      // Modélisation laissait `activeTab` sur 'settings', et donc le bouton
      // "Modélisation" restait actif (cyan) par-dessus "Prévisualisation". Le second argument
      // signale spécifiquement ce cas-là à Index.tsx (venant de Modélisation, vers
      // Prévisualisation et non vers Préparation), pour qu'il joue le bon morph de sortie.
      onTabChange('box', true);
      setIsPreviewActive(true);
      window.dispatchEvent(new CustomEvent('apex-tool-changed', { detail: { tool: 'layers' } }));
      window.dispatchEvent(new CustomEvent('apex-preview-toggled', { detail: { active: true } }));
      // Dispatché en DERNIER, une fois `apex-preview-toggled` déjà parti : useGCodePreview
      // (Index.tsx) doit être passé à `active` avant de recevoir le fichier, sans quoi son
      // écouteur de dépôt (qui double aussi comme point d'entrée de chargement, cf.
      // use-gcode-preview.ts) ignorerait l'événement.
      if (pendingFile) {
        window.dispatchEvent(new CustomEvent('apex-entering-preview-with-file', { detail: { file: pendingFile } }));
      }
    });
  };

  const handleLayerClick = () => {
    const entering = activeTool !== 'layers';

    if (entering) {
      enterPreview();
    } else {
      playSpaceTransition('box', () => {
        setActiveTool('select');
        setIsPreviewActive(false);
        window.dispatchEvent(new CustomEvent('apex-tool-changed', { detail: { tool: 'select' } }));
        window.dispatchEvent(new CustomEvent('apex-preview-toggled', { detail: { active: false } }));
      });
    }
  };

  // Page de démarrage (Paramètres) : l'application s'ouvre sur l'Accueil (sans 3D, c'est lui que le
  // splash attend), puis, l'Accueil prêt, rejoint l'espace choisi une seule fois, par le même geste
  // que le clic sur son onglet (rideau compris) — toute la mécanique de transition reste donc celle
  // de l'utilisation normale. Modélisation n'existe qu'avec la valeur « dev ».
  useEffect(() => {
    const page = getStartPage();
    if (page === 'home') return;
    let timer: number | undefined;
    const go = () => {
      timer = window.setTimeout(() => {
        if (page === 'prepare') handleTopTabClick('box');
        else if (page === 'preview') enterPreview();
        else if (page === 'modeling' && isDevModeEnabled()) handleTopTabClick('settings');
      }, 1200);
    };
    window.addEventListener('apex-home-ready', go, { once: true });
    return () => {
      window.removeEventListener('apex-home-ready', go);
      if (timer !== undefined) window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- une seule fois, au montage
  }, []);

  // Dépôt d'un fichier G-code n'importe où dans la fenêtre pendant qu'on est en Préparation (hors
  // Prévisualisation, hors Modélisation) : bascule automatiquement vers l'espace Prévisualisation,
  // avec la même animation que le clic sur son icône, puis charge le fichier une fois l'écran
  // découvert (cf. `enterPreview`). Un simple survol (dragenter/dragover) sans dépôt ne déclenche
  // rien — jamais de bascule sur un simple passage de fichier au-dessus de la fenêtre.
  useEffect(() => {
    if (isPreviewActive || isModeling) return;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      const file = e.dataTransfer?.files?.[0];
      if (!file || !GCODE_FILE_EXT.test(file.name)) return;
      e.preventDefault();
      enterPreview(file);
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPreviewActive, isModeling]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (['INPUT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable)) {
        return;
      }

      const key = e.key.toLowerCase();
      if (key === 'm') {
        const newTool = activeTool === 'move' ? 'select' : 'move';
        setActiveTool(newTool);
        window.dispatchEvent(new CustomEvent('apex-tool-changed', { detail: { tool: newTool } }));
        announceTool(newTool);
      } else if (key === 'r') {
        const newTool = activeTool === 'rotate' ? 'select' : 'rotate';
        setActiveTool(newTool);
        window.dispatchEvent(new CustomEvent('apex-tool-changed', { detail: { tool: newTool } }));
        announceTool(newTool);
      } else if (key === 's') {
        const newTool = activeTool === 'scale' ? 'select' : 'scale';
        setActiveTool(newTool);
        window.dispatchEvent(new CustomEvent('apex-tool-changed', { detail: { tool: newTool } }));
        announceTool(newTool);
      } else if (key === 't') {
        const newTool = activeTool === 'texture' ? 'select' : 'texture';
        setActiveTool(newTool);
        window.dispatchEvent(new CustomEvent('apex-tool-changed', { detail: { tool: newTool } }));
        announceTool(newTool);
      } else if (key === 'escape') {
        if (activeTool !== 'select') announceTool('select');
        setActiveTool('select');
        window.dispatchEvent(new CustomEvent('apex-tool-changed', { detail: { tool: 'select' } }));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeTool]);

  // Mesure la largeur naturelle de la barre slicer dès qu'on la voit au repos (mode box,
  // aucune transition en cours) — la toute première fois, et à nouveau si jamais elle
  // n'a pas encore été capturée (ex : l'app démarre directement sur un autre onglet).
  useEffect(() => {
    if (boxWidth === null && !isModeling && !isPreviewActive && bottomToolbarRef.current) {
      setBoxWidth(bottomToolbarRef.current.getBoundingClientRect().width);
    }
  }, [boxWidth, isModeling, isPreviewActive]);

  // Décalage x/y nécessaire pour que la colonne d'outils du mode Prévisualisation vienne se
  // coller au bord droit de l'écran, juste sous le ViewCube. `.container` (l'ancêtre direct)
  // est centré par `left: 50%` quel que soit l'état, donc son centre horizontal vaut
  // toujours exactement `window.innerWidth / 2` — inutile de mesurer le DOM, une formule
  // suffit et reste valable pendant toute animation. Le `top` de repos du conteneur est lui
  // fixe (posé par le CSS de `.container`/`.topToolbar`, pas par une mesure runtime).
  useEffect(() => {
    const recompute = () => {
      const restCenterX = window.innerWidth / 2;
      const targetCenterX = window.innerWidth - VIEWCUBE_RIGHT - PREVIEW_TOOLBAR_WIDTH / 2;
      const targetTop = VIEWCUBE_BOTTOM + PREVIEW_TOOLBAR_TOP_GAP;

      setPreviewX(targetCenterX - restCenterX);
      setPreviewY(targetTop - BOTTOM_TOOLBAR_REST_TOP);
    };

    recompute();
    window.addEventListener('resize', recompute);
    return () => window.removeEventListener('resize', recompute);
  }, []);

  useEffect(() => {
    if (topToolbarRef.current && buttonRefs.current.size > 0) {
      const activeButtonKey = activeTool === 'layers' ? 'layers' : (activeTab === '3d-view' ? 'box' : activeTab);
      const activeButton = buttonRefs.current.get(activeButtonKey);

      setIndicatorOnLogo(activeButtonKey === 'home');
      if (activeButton) {
        const toolbarRect = topToolbarRef.current.getBoundingClientRect();
        const buttonRect = activeButton.getBoundingClientRect();

        // Sur le logo, la boîte déborde du bouton pour que le triangle entoure le logo.
        const padX = activeButtonKey === 'home' ? LOGO_PAD_X : 0;
        const padY = activeButtonKey === 'home' ? LOGO_PAD_Y : 0;
        setIndicatorStyle({
          width: buttonRect.width + 2 * padX,
          height: buttonRect.height + 2 * padY,
          left: buttonRect.left - toolbarRect.left - padX,
          top: buttonRect.top - toolbarRect.top - padY,
          opacity: 1,
        });
      } else {
        setIndicatorStyle((prev) => ({ ...prev, opacity: 0 }));
      }
    }
  }, [activeTab, activeTool]);

  const iconVariants: Variants = {
    // Les icônes du mode cible n'apparaissent qu'UNE FOIS le reshape du conteneur terminé
    // (durée totale de l'animation de `.bottomToolbar`, voir CONTAINER_RESHAPE_DURATION) —
    // dans tous les sens de transition, pas seulement Prévisualisation→Modélisation. Sans ce
    // délai de base, les icônes du nouveau mode démarraient leur propre petit délai en
    // cascade (`i*0.04`) dès le changement de state React, bien avant que le conteneur ait
    // fini de se déplacer/déformer.
    visible: (i: number) => ({
      opacity: 1,
      y: 0,
      scale: 1,
      transition: {
        delay: CONTAINER_RESHAPE_DURATION + i * 0.04,
        duration: 0.3,
        ease: [0.16, 1, 0.3, 1] as const
      }
    }),
    // La sortie, elle, doit rester immédiate : les icônes du mode qu'on quitte doivent avoir
    // disparu AVANT que le conteneur ne commence à se déformer (cf. keyframes `times` de
    // `.bottomToolbar` : vidage sur les premiers 45%, déformation sur les 55% restants).
    hidden: (i: number) => ({
      opacity: 0,
      y: 15,
      scale: 0.95,
      transition: {
        delay: i * 0.04,
        duration: 0.25,
        ease: [0.25, 1, 0.5, 1] as const
      }
    })
  };

  return (
    <div className={styles.container} data-apex-chrome-panel>
      {/* Top Toolbar (Navigation & Main Views) */}
      <div
        ref={topToolbarRef}
        data-apex-tooltip="Barre d'onglets des espaces de travail d'Apex : cliquez un onglet pour changer d'espace."
        className={clsx(styles.toolbar, styles.topToolbar)}
      >
        <div className={styles.activeIndicator} style={indicatorStyle}>
          <div className={styles.activeIndicatorShape} style={{ clipPath: indicatorOnLogo ? TRIANGLE_CLIP : PILL_CLIP }} />
        </div>

        <CustomTooltip content="Apex Slicer Studio" description={devMode ? APP_TAGLINE_DEV : APP_TAGLINE_PREVIEW}>
          <button
            ref={(el) => { if (el) buttonRefs.current.set('home', el); }}
            className={styles.logoContainer}
            onClick={() => handleTopTabClick('home')}
            aria-label="Accueil"
          >
            <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="Logo" className={styles.logoImg} />
          </button>
        </CustomTooltip>

        <div className={styles.topSeparator} />

        {devMode && (
          <CustomTooltip content="Vue 3D Perspective" description="Basculez sur l'espace de travail principal pour inspecter et manipuler vos modèles sur le plateau d'impression.">
            <button
              ref={(el) => { if (el) buttonRefs.current.set('box', el); }}
              className={clsx(styles.button, styles.topButton, {
                [styles.active]: activeTab === '3d-view' && !isPreviewActive,
              })}
              onClick={() => handleTopTabClick('box')}
            >
              <FileSliders size={22} />
              <span className={styles.topButtonLabel}>Préparation</span>
            </button>
          </CustomTooltip>
        )}

        <CustomTooltip content="Prévisualisation" description="Visualisez le parcours de la buse et ajustez différents paramètres si cela ne vous convient pas.">
          <button
            ref={(el) => { if (el) buttonRefs.current.set('layers', el); }}
            className={clsx(styles.button, styles.topButton, {
              [styles.active]: isPreviewActive,
            })}
            onClick={handleLayerClick}
          >
            <Layers size={22} />
            <span className={styles.topButtonLabel}>Prévisualisation</span>
          </button>
        </CustomTooltip>

        {devMode && (
          <CustomTooltip content="Modélisation" description="Accédez aux outils de modélisation et de préparation de votre modèle.">
            <button
              ref={(el) => { if (el) buttonRefs.current.set('settings', el); }}
              className={clsx(styles.button, styles.topButton, {
                [styles.active]: activeTab === 'settings',
              })}
              onClick={() => handleTopTabClick('settings')}
            >
              <Box size={22} />
              <span className={styles.topButtonLabel}>Modélisation</span>
            </button>
          </CustomTooltip>
        )}

        {devMode && (
          <CustomTooltip content="Console Développeur" description="Inspectez les flux G-code générés en temps réel et les journaux de diagnostic système.">
            <button
              ref={(el) => { if (el) buttonRefs.current.set('developer', el); }}
              className={clsx(styles.button, styles.topButton, {
                [styles.active]: activeTab === 'developer',
              })}
              onClick={() => handleTopTabClick('developer')}
            >
              <Code size={22} />
              <span className={styles.topButtonLabel}>Dev</span>
            </button>
          </CustomTooltip>
        )}

        <CustomTooltip content="Paramètres" description="Réglages généraux de l'application, sans le viewport 3D.">
          <button
            ref={(el) => { if (el) buttonRefs.current.set('params', el); }}
            className={clsx(styles.button, styles.topButton, {
              [styles.active]: activeTab === 'params',
            })}
            onClick={() => handleTopTabClick('params')}
          >
            <Settings size={22} />
            <span className={styles.topButtonLabel}>Paramètres</span>
          </button>
        </CustomTooltip>
      </div>

      {/* Bottom Toolbar (Action, Manipulation 3D) — UN SEUL conteneur physique pour les 3
          modes (slicer / prévisualisation / modélisation) : il ne se démonte jamais, il se
          vide de ses icônes, se déplace et se déforme, puis affiche les icônes du mode
          suivant. En mode modélisation les boutons CAD ne sont pas rendus ici : ils vivent
          dans ModelingSidebar (toute la logique de features y reste), qui les injecte dans
          `modelingSlotRef` via un portail — même noeud DOM, contenu apporté par le
          propriétaire de sa logique. */}
      <motion.div
        // Enveloppe indépendante du morph de forme ci-dessous (fromGeometry/targetGeometry) :
        // en Paramètres, le pilule d'outils du viewport n'a plus lieu d'être affichée — elle
        // fondu-glisse en dehors plutôt que de se déformer vers un gabarit qui n'existe pas
        // pour cet espace.
        animate={{ opacity: isParams ? 0 : 1, y: isParams ? 24 : 0 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        style={{ pointerEvents: isParams ? 'none' : 'auto' }}
      >
      <motion.div
        ref={bottomToolbarRef}
        className={clsx(styles.toolbar, styles.bottomToolbar)}
        initial={false}
        animate={fromGeometry ? {
          // Toute transition (slicer ↔ prévisualisation, slicer ↔ modélisation) part
          // TOUJOURS de la forme réellement mesurée juste avant (`fromGeometry`) pour
          // rejoindre le gabarit du mode cible — un seul et même conteneur qui se vide de
          // ses icônes (cf. iconVariants), se déplace et se déforme, jamais deux
          // composants qui se croisent.
          x: [fromGeometry.x, fromGeometry.x, targetGeometry.x],
          y: [fromGeometry.y, fromGeometry.y, targetGeometry.y],
          width: [fromGeometry.width, fromGeometry.width, targetGeometry.width],
          height: [fromGeometry.height, fromGeometry.height, targetGeometry.height],
          borderRadius: [fromGeometry.borderRadius, fromGeometry.borderRadius, targetGeometry.borderRadius],
          opacity: 1,
          marginTop: 0
        } : {
          // État initial (avant toute transition jouée) : forme de repos du mode courant,
          // sans animation. "auto" tant que la largeur naturelle n'a pas encore été mesurée
          // (premier rendu), un nombre dès qu'elle l'est — évite un saut visuel une fois
          // `boxWidth` connu puisque `targetGeometry.width` vaudra alors la même valeur.
          x: targetGeometry.x,
          y: targetGeometry.y,
          width: isModeling || boxWidth !== null ? targetGeometry.width : "auto",
          height: targetGeometry.height,
          borderRadius: targetGeometry.borderRadius,
          opacity: 1,
          marginTop: 0
        }}
        transition={
          // Esquisse actif : les icônes se replient d'abord (~0,3 s), puis la barre se raccourcit ;
          // à la fin de l'esquisse, la barre s'élargit tout de suite et les icônes reviennent.
          sketchReshape === 'in'
            ? { duration: 0.8, times: [0, 0.35, 1], ease: [0.25, 1, 0.5, 1] }
            : sketchReshape === 'out'
              ? { duration: 0.5, times: [0, 0.02, 1], ease: [0.25, 1, 0.5, 1] }
              : { duration: CONTAINER_RESHAPE_DURATION, times: [0, 0.45, 1], ease: [0.25, 1, 0.5, 1] }
        }
        style={{ originX: 0.5, originY: 0.5, pointerEvents: 'auto' }}
      >
        <motion.div custom={0} variants={iconVariants} animate={isPreviewActive || isModeling ? "hidden" : "visible"} initial="visible" className="flex items-center">
          <CustomTooltip content="Outil de Sélection" description="Cliquez sur n'importe quel modèle 3D sur le plateau pour le sélectionner et afficher ses propriétés.">
            <button
              className={clsx(styles.button, styles.bottomButton, {
                [styles.active]: activeTool === 'select',
              })}
              onClick={() => handleToolClick('select')}
            >
              <MousePointer2 size={16} />
            </button>
          </CustomTooltip>
        </motion.div>

        <motion.div custom={1} variants={iconVariants} animate={isPreviewActive || isModeling ? "hidden" : "visible"} initial="visible" className="flex items-center">
          <CustomTooltip content="Outil de Déplacement (Move - M)" description="Affichez les gizmos directionnels pour repositionner précisément l'objet sur le plateau d'impression. (Raccourci : M)">
            <button
              className={clsx(styles.button, styles.bottomButton, {
                [styles.active]: activeTool === 'move',
              })}
              onClick={() => handleToolClick('move')}
            >
              <Move3d size={16} />
            </button>
          </CustomTooltip>
        </motion.div>

        <motion.div custom={2} variants={iconVariants} animate={isPreviewActive || isModeling ? "hidden" : "visible"} initial="visible" className="flex items-center">
          <CustomTooltip content="Outil de Rotation (Rotate - R)" description="Faites pivoter le modèle selon les axes X, Y et Z pour optimiser son orientation de contact. (Raccourci : R)">
            <button
              className={clsx(styles.button, styles.bottomButton, {
                [styles.active]: activeTool === 'rotate',
              })}
              onClick={() => handleToolClick('rotate')}
            >
              <RotateCw size={16} />
            </button>
          </CustomTooltip>
        </motion.div>

        <motion.div custom={3} variants={iconVariants} animate={isPreviewActive || isModeling ? "hidden" : "visible"} initial="visible" className="flex items-center">
          <CustomTooltip content="Outil de Mise à l'échelle (Scale - S)" description="Modifiez la taille et les proportions du modèle 3D sur le plateau d'impression. (Raccourci : S)">
            <button
              className={clsx(styles.button, styles.bottomButton, {
                [styles.active]: activeTool === 'scale',
              })}
              onClick={() => handleToolClick('scale')}
            >
              <Maximize size={16} />
            </button>
          </CustomTooltip>
        </motion.div>

        <motion.div custom={4} variants={iconVariants} animate={isPreviewActive || isModeling ? "hidden" : "visible"} initial="visible" className="flex items-center">
          <CustomTooltip content="Outil Texture & Matériau (Texture - T)" description="Sélectionnez et éditez les textures et propriétés de matériaux du modèle actif. (Raccourci : T)">
            <button
              className={clsx(styles.button, styles.bottomButton, {
                [styles.active]: activeTool === 'texture',
              })}
              onClick={() => handleToolClick('texture')}
            >
              <Palette size={16} />
            </button>
          </CustomTooltip>
        </motion.div>

        <motion.div custom={5} variants={iconVariants} animate={isPreviewActive || isModeling ? "hidden" : "visible"} initial="visible" className="flex items-center">
          <div className={styles.separator} />
        </motion.div>

        <motion.div custom={6} variants={iconVariants} animate={isPreviewActive || isModeling ? "hidden" : "visible"} initial="visible" className="flex items-center">
          <CustomTooltip content="Réinitialiser la Caméra" description="Remettez la caméra dans sa position isométrique par défaut face au plateau.">
            <button
              className={clsx(styles.button, styles.bottomButton)}
              onClick={() => window.dispatchEvent(new CustomEvent('apex-reset-camera'))}
            >
              <Eye size={16} />
            </button>
          </CustomTooltip>
        </motion.div>

        <motion.div custom={7} variants={iconVariants} animate={isPreviewActive || isModeling ? "hidden" : "visible"} initial="visible" className="flex items-center">
          <CustomTooltip content="Ajuster à l'Écran (Fit)" description="Zoomez et recentrez la vue automatiquement sur le modèle sélectionné.">
            <button
              className={clsx(styles.button, styles.bottomButton)}
              onClick={() => window.dispatchEvent(new CustomEvent('apex-fit-screen'))}
            >
              <Maximize2 size={16} />
            </button>
          </CustomTooltip>
        </motion.div>

        <motion.div custom={8} variants={iconVariants} animate={isPreviewActive || isModeling ? "hidden" : "visible"} initial="visible" className="flex items-center">
          <div className={styles.separator} />
        </motion.div>

        <motion.div custom={9} variants={iconVariants} animate={isPreviewActive || isModeling ? "hidden" : "visible"} initial="visible" className="flex items-center">
          <CustomTooltip content="Importer un Modèle 3D (.stl, .glb, .gltf)" description="Ouvrez le sélecteur de fichiers pour charger un nouveau fichier 3D avec textures sur le plateau.">
            <button
              className={clsx(styles.button, styles.bottomButton, styles.uploadActionButton)}
              onClick={handleUploadClick}
            >
              <Upload size={16} />
            </button>
          </CustomTooltip>
        </motion.div>

        {/* Mode Prévisualisation : icônes qui basculent le contenu du panneau du haut
            (cf. PreviewUpperTabs). */}
        <div
          className={styles.previewSlot}
          style={{ pointerEvents: isPreviewActive && !isModeling ? 'auto' : 'none' }}
        >
          {PREVIEW_TABS.map((t, i) => (
            <motion.div
              key={t.id}
              custom={i}
              variants={iconVariants}
              animate={isPreviewActive && !isModeling ? "visible" : "hidden"}
              initial="hidden"
              className="flex items-center"
            >
              <CustomTooltip
                content={t.label}
                description={!devMode && t.id === 'fonction' ? 'Arrive bientôt' : t.description}
              >
                <button
                  className={clsx(styles.button, styles.bottomButton, { [styles.active]: previewTab === t.id })}
                  style={!devMode && t.id === 'fonction' ? { opacity: 0.35, filter: 'grayscale(1)', cursor: 'not-allowed' } : undefined}
                  aria-label={t.label}
                  aria-pressed={previewTab === t.id}
                  aria-disabled={!devMode && t.id === 'fonction'}
                  onClick={() => { if (devMode || t.id !== 'fonction') setPreviewTab(t.id); }}
                >
                  {t.icon}
                </button>
              </CustomTooltip>
            </motion.div>
          ))}
        </div>

        {/* Mode modélisation : mêmes noeud et animation de conteneur que le mode slicer —
            seul le contenu diffère. Les boutons CAD eux-mêmes (logique de features) sont
            possédés par ModelingSidebar, qui les injecte ici via un portail (voir
            modelingSlotRef) plutôt que d'être dupliqués ou recréés dans ce composant. */}
        <motion.div
          custom={0}
          variants={iconVariants}
          animate={isModeling ? "visible" : "hidden"}
          initial="hidden"
          ref={modelingSlotRef}
          id="apex-modeling-toolbar-slot"
          className={styles.modelingSlot}
        />

        <input
          type="file"
          ref={fileInputRef}
          style={{ display: 'none' }}
          accept=".stl,.glb,.gltf"
          onChange={(e) => {
            if (e.target.files?.[0]) {
              window.dispatchEvent(
                new CustomEvent('apex-import-model', {
                  detail: e.target.files[0],
                })
              );
            }
            // Réinitialise la valeur pour pouvoir réimporter exactement le même fichier
            // à la suite (sinon le navigateur ne redéclenche pas onChange).
            e.target.value = '';
          }}
        />
      </motion.div>
      </motion.div>
    </div>
  );
};