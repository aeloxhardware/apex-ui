import React from 'react';
import { motion, type MotionProps } from 'framer-motion';
import { AmsWithDialogs } from './AmsWithDialogs';
import styles from './AmsCard.module.scss';

/**
 * L'AMS dans la colonne gauche de Préparation, à la place de l'ancienne carte Filament. Sa hauteur (192 px) est comptée
 * par ModelStatusBox (ResizeObserver sur toute la colonne) : les catégories et le panneau de réglages en dessous sont
 * repoussés d'autant, et la hauteur maximale du panneau de réglages se réduit en conséquence. Le filament actif est
 * celui du slot 1 (`amsStore.ts`).
 */
export const AmsCard: React.FC<{ motionProps: MotionProps }> = ({ motionProps }) => (
  <motion.div className={styles.card} {...motionProps}>
    <AmsWithDialogs />
  </motion.div>
);
