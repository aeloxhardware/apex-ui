"use client";

import React from 'react';
import styles from './GCodePreview.module.scss';

/**
 * Espace Prévisualisation, partie viewport : un simple calque marqueur au-dessus du rendu 3D
 * (le tracé lui-même est dessiné par Viewport3D, dans la même scène que la Préparation). Reste
 * monté à l'intérieur de `main` (borné à l'espace 3D), donc sous le rideau de transition
 * (SpaceTransitionOverlay) qui ne doit couvrir que le viewport — voir Index.tsx.
 *
 * La logique (chargement de fichier, lecture, trajets à vide) vit dans `useGCodePreview`, appelé
 * par Index.tsx : la barre de lecture (GCodePreviewBar) partage sa rangée avec le statut du
 * plateau, ce qui demande que les deux soient des enfants directs du même conteneur flex plutôt
 * que des composants positionnés indépendamment l'un de l'autre.
 */

interface GCodePreviewProps {
  /** Espace Prévisualisation affiché. */
  active: boolean;
}

export const GCodePreview: React.FC<GCodePreviewProps> = ({ active }) => {
  if (!active) return null;

  return <div className={styles.container} />;
};
