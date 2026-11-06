import React, { useEffect, useRef, useState } from 'react';
import { MODEL_FILE_EXT, importModelsOneByOne } from '@/utils/importModels';
import { LOGO_PAD_X, LOGO_PAD_Y } from '@/utils/indicatorShapes';
import { GCODE_FILE_EXT } from '@/hooks/use-gcode-preview';
import { isDevModeEnabled } from '@/utils/devModePrefs';
import { getStartPage } from '@/utils/startPagePrefs';
import {
  VIEWCUBE_RIGHT, VIEWCUBE_BOTTOM, PREVIEW_TOOLBAR_TOP_GAP, PREVIEW_TOOLBAR_WIDTH, BOTTOM_TOOLBAR_REST_TOP,
} from './sidebarData';

import { emitApex } from '@/events/apexEvents';
export type SidebarTool = 'select' | 'move' | 'rotate' | 'scale' | 'texture' | 'layers';
export type TabName = 'box' | 'settings' | 'developer' | 'params' | 'home';

type Geometry = { x: number; y: number; width: number; height: number; borderRadius: number };

/**
 * Forme du conteneur commun d'outils (slicer / prévisualisation / modélisation) : gabarit cible de chaque
 * mode, forme mesurée juste avant une transition (`fromGeometry`), largeur naturelle de la barre slicer
 * (mesurée une fois : une keyframe `"auto"` mêlée à des nombres n'anime pas avec framer-motion) et décalage de
 * la colonne de Prévisualisation, qui vient se coller sous le ViewCube.
 */
export function useToolbarGeometry(isModeling: boolean, isPreviewActive: boolean) {
  const [fromGeometry, setFromGeometry] = useState<Geometry | null>(null);
  const [boxWidth, setBoxWidth] = useState<number | null>(null);
  const [previewX, setPreviewX] = useState(0);
  const [previewY, setPreviewY] = useState(0);
  const bottomToolbarRef = useRef<HTMLDivElement>(null);
  // Géométrie de repos courante, relue par les écouteurs montés une seule fois.
  const targetGeometryRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  // Outil Esquisse actif (annoncé par ModelingSidebar) : la barre CAD ne garde que son bouton.
  const [modelingSketchActive, setModelingSketchActive] = useState(false);
  // Sens du redimensionnement de la barre CAD (Esquisse actif / terminé) : change le séquencement.
  const [sketchReshape, setSketchReshape] = useState<'in' | 'out' | null>(null);

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

  const targetGeometry: Geometry = isModeling
    ? { x: 0, y: 0, width: modelingSketchActive ? 50 : 274, height: 50, borderRadius: 14 } // barre CAD (6 boutons de 38px + séparateur) ; Esquisse seul : 1 bouton
    : isPreviewActive
      ? { x: previewX, y: previewY, width: PREVIEW_TOOLBAR_WIDTH, height: 340, borderRadius: 20 } // colonne de calques
      : { x: 0, y: 0, width: boxWidth ?? 332, height: 44, borderRadius: 22 }; // barre slicer
  targetGeometryRef.current = { x: targetGeometry.x, y: targetGeometry.y };

  // Mesure la largeur naturelle de la barre slicer dès qu'on la voit au repos (mode box, aucune transition en cours).
  useEffect(() => {
    if (boxWidth === null && !isModeling && !isPreviewActive && bottomToolbarRef.current) {
      setBoxWidth(bottomToolbarRef.current.getBoundingClientRect().width);
    }
  }, [boxWidth, isModeling, isPreviewActive]);

  // Décalage x/y pour que la colonne de Prévisualisation vienne se coller au bord droit, sous le ViewCube.
  // `.container` est centré par `left: 50%` : son centre vaut toujours `window.innerWidth / 2`, une formule suffit.
  useEffect(() => {
    const recompute = () => {
      const restCenterX = window.innerWidth / 2;
      const targetCenterX = window.innerWidth - VIEWCUBE_RIGHT - PREVIEW_TOOLBAR_WIDTH / 2;
      setPreviewX(targetCenterX - restCenterX);
      setPreviewY(VIEWCUBE_BOTTOM + PREVIEW_TOOLBAR_TOP_GAP - BOTTOM_TOOLBAR_REST_TOP);
    };
    recompute();
    window.addEventListener('resize', recompute);
    return () => window.removeEventListener('resize', recompute);
  }, []);

  return {
    fromGeometry, setFromGeometry, boxWidth, bottomToolbarRef, targetGeometry, modelingSketchActive, sketchReshape,
    setSketchReshape,
  };
}

/** Surlignage coulissant de l'onglet actif ; sur le logo (Accueil), il devient un triangle aux bords arrondis. */
export function useTabIndicator(activeTab: string, activeTool: SidebarTool) {
  const topToolbarRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [indicatorStyle, setIndicatorStyle] = React.useState<React.CSSProperties>({});
  const [indicatorOnLogo, setIndicatorOnLogo] = React.useState(false);
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
  return { topToolbarRef, buttonRefs, indicatorStyle, indicatorOnLogo };
}

const SHORTCUT_TOOLS = { m: 'move', r: 'rotate', s: 'scale', t: 'texture' } as const;

/** Raccourcis M / R / S / T (bascule de l'outil) et Échap (retour à la sélection). */
export function useToolShortcuts(
  activeTool: SidebarTool,
  isPreviewActive: boolean,
  applyTool: (tool: SidebarTool, announce: boolean) => void,
  announceSelect: () => void,
) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (['INPUT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable)) return;
      const key = e.key.toLowerCase();
      // Prévisualisation : M / R / S / T (outils de Préparation) ne doivent rien faire.
      if (isPreviewActive && key in SHORTCUT_TOOLS) return;
      if (key in SHORTCUT_TOOLS) {
        const tool = SHORTCUT_TOOLS[key as keyof typeof SHORTCUT_TOOLS];
        applyTool(activeTool === tool ? 'select' : tool, true);
      } else if (key === 'escape') {
        if (activeTool !== 'select') announceSelect();
        applyTool('select', false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dépendances volontairement limitées : effet à déclenchement ciblé
  }, [activeTool, isPreviewActive]);
}

interface StartEvents {
  activeTab: TabName | '3d-view';
  isPreviewActive: boolean;
  isModeling: boolean;
  handleTopTabClick: (tab: TabName) => void;
  enterPreview: (file?: File) => void;
}

/**
 * Page de démarrage : l'application s'ouvre sur l'Accueil (sans 3D, c'est lui que le splash attend), puis, l'Accueil
 * prêt, rejoint l'espace choisi une seule fois, par le même geste que le clic sur son onglet (rideau compris).
 * Modélisation n'existe qu'avec la valeur « dev ».
 */
function useStartPage({ handleTopTabClick, enterPreview }: StartEvents) {
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
}

/** Dépôt d'un fichier n'importe où dans la fenêtre : modèles 3D sur le plateau, G-code vers la Prévisualisation. */
function useFileDropRouting({ activeTab, isPreviewActive, isModeling, enterPreview }: StartEvents) {
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
      const files = Array.from(e.dataTransfer?.files ?? []);
      const file = files[0];
      if (!file) return;
      // Préparation seulement (le viewport est démonté sur Accueil / Paramètres) : modèles 3D déposés
      // sur le plateau, comme avec le bouton d'import (mêmes formats que son sélecteur).
      if (activeTab === '3d-view') {
        const models = files.filter((f) => MODEL_FILE_EXT.test(f.name));
        if (models.length > 0) {
          e.preventDefault();
          void importModelsOneByOne(models);
          return;
        }
      }
      if (!GCODE_FILE_EXT.test(file.name)) return;
      e.preventDefault();
      enterPreview(file);
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dépendances volontairement limitées : effet à déclenchement ciblé
  }, [isPreviewActive, isModeling, activeTab]);
}

/** Événements qui déclenchent une bascule : page de démarrage, G-code produit par le moteur, fichier déposé. */
export function useSpaceEntryEvents(o: StartEvents) {
  useStartPage(o);
  // G-code produit par le moteur : ouvert dans l'espace Prévisualisation (comme un fichier déposé).
  useEffect(() => {
    const onOpen = (e: Event) => {
      const file = (e as CustomEvent<{ file: File }>).detail?.file;
      if (!file) return;
      if (o.isPreviewActive) emitApex('apex-entering-preview-with-file', { file });
      else if (!o.isModeling) o.enterPreview(file);
    };
    window.addEventListener('apex-open-sliced-gcode', onOpen);
    return () => window.removeEventListener('apex-open-sliced-gcode', onOpen);
  });
  useFileDropRouting(o);
}
