import hoverSrc from '@/assets/sounds/hover.mp3';
import clickSrc from '@/assets/sounds/click.mp3';
import spacePreparationSrc from '@/assets/sounds/space-preparation.mp3';
import spacePreviewSrc from '@/assets/sounds/space-preview.mp3';
import spaceModelingSrc from '@/assets/sounds/space-modeling.mp3';

export interface LibrarySound {
  id: string;
  title: string;
  /** Où et quand l'application joue ce son. */
  description: string;
  src: string;
  /** Nom du fichier au téléchargement. */
  filename: string;
}

export interface LibrarySection {
  title: string;
  sounds: LibrarySound[];
}

const SPACE_CURTAIN = 'au début de la transition vers l’espace';

const INTERFACE_SOUNDS: LibrarySound[] = [
  {
    id: 'hover',
    title: 'Survol',
    description:
      'Joué quand le pointeur arrive sur un bouton, un onglet, une case ou tout autre élément interactif de l’interface (volume 35 %). Les sons de l’interface sont coupés par défaut : le bouton haut-parleur de la barre de fichiers les active.',
    src: hoverSrc,
    filename: 'apex-survol.mp3',
  },
  {
    id: 'click',
    title: 'Clic',
    description:
      'Joué à chaque clic sur un élément interactif de l’interface (volume 50 %). Coupé par défaut, comme le son de survol.',
    src: clickSrc,
    filename: 'apex-clic.mp3',
  },
  {
    id: 'space-preparation',
    title: 'Espace Préparation',
    description: `Joué ${SPACE_CURTAIN} Préparation (rideau « APEX / Préparation »), sans le blanc de 0,3 s du début du fichier.`,
    src: spacePreparationSrc,
    filename: 'apex-espace-preparation.mp3',
  },
  {
    id: 'space-modeling',
    title: 'Espace Modélisation',
    description: `Joué ${SPACE_CURTAIN} Modélisation (rideau « APEX / Modélisation »), sans le blanc de 0,3 s du début du fichier.`,
    src: spaceModelingSrc,
    filename: 'apex-espace-modelisation.mp3',
  },
  {
    id: 'space-preview',
    title: 'Espace Prévisualisation',
    description: `Joué ${SPACE_CURTAIN} Prévisualisation (rideau « APEX / Prévisualisation »), sans le blanc de 0,3 s du début du fichier. Les espaces Dev et Paramètres n’ont pas de son.`,
    src: spacePreviewSrc,
    filename: 'apex-espace-previsualisation.mp3',
  },
];

export const SOUND_LIBRARY: LibrarySection[] = [
  { title: 'Interface', sounds: INTERFACE_SOUNDS },
];
