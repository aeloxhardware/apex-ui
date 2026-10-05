import React from 'react';
import { motion } from 'framer-motion';
import type { GCodeFileInfo } from '@/hooks/use-gcode-preview';
import styles from './GCodeInfoPanel.module.scss';

interface GCodeInfoPanelProps {
  fileInfo: GCodeFileInfo | null;
}

const formatNumber = (value: number, digits: number) => value.toFixed(digits).replace('.', ',');

const formatDuration = (seconds: number) => {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h} h ${m} m ${s} s`;
  return m > 0 ? `${m} m ${s} s` : `${s} s`;
};

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.03 } },
};
const itemVariants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.22, ease: [0.4, 0, 0.2, 1] as const } },
};

/**
 * Informations sur le G-code chargé, en haut du panneau du bas de Prévisualisation (au-dessus du
 * sélecteur de vitesse) : fichier, logiciel d'origine, format, imprimante, durée et filament.
 */
export const GCodeInfoPanel = React.memo<GCodeInfoPanelProps>(({ fileInfo }) => {
  if (!fileInfo) {
    return <p className={styles.empty}>Aucun G-code chargé : déposez un fichier .gcode sur la fenêtre.</p>;
  }

  let filamentMm = 0;
  let massG = 0;
  for (const stat of Object.values(fileInfo.lineStats)) {
    filamentMm += stat.filamentMm;
    massG += stat.massG;
  }
  const generator = fileInfo.generator
    ? `${fileInfo.generator.name}${fileInfo.generator.inferred ? ' (déduit du format)' : ''}`
    : 'Inconnu';

  const rows: [string, string][] = [
    ['Fichier', fileInfo.name],
    ['Généré le plus probablement par', generator],
    ['Format', fileInfo.kind === 'cartesian'
      ? fileInfo.toolOriented ? "3 axes + orientation d'outil (B/C)" : '3 axes (cartésien)'
      : fileInfo.conversion
        ? `4 axes (polaire Apex, converti${fileInfo.conversion === 'dynamic' ? ' — angle dynamique' : ''})`
        : '4 axes (polaire Apex)'],
    ...(fileInfo.printer ? [['Imprimante', fileInfo.printer] as [string, string]] : []),
    ['Durée estimée', formatDuration(fileInfo.totalTime)],
    ['Mouvements', fileInfo.moves.toLocaleString('fr-FR')],
    ['Filament', `${formatNumber(filamentMm / 1000, 2)} m · ${formatNumber(massG, 2)} g`],
  ];

  return (
    // `key` : la cascade d'apparition se rejoue à chaque nouveau fichier.
    <motion.dl key={fileInfo.name} className={styles.root} variants={containerVariants} initial="hidden" animate="visible">
      {rows.map(([label, value]) => (
        <motion.div key={label} className={styles.row} variants={itemVariants}>
          <dt className={styles.label}>{label}{' '}:</dt>
          <dd className={styles.value} title={value}>{value}</dd>
        </motion.div>
      ))}
    </motion.dl>
  );
});
GCodeInfoPanel.displayName = 'GCodeInfoPanel';
