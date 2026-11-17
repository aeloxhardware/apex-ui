import React, { useRef } from 'react';
import { motion } from 'framer-motion';
import { FolderOpen, Plus } from '@/lib/icons';
import { emitApex } from '@/events/apexEvents';
import { openProjectOnPlate, PROJECT_FILE_EXT } from '@/utils/projectOpen';
import { showError, showWarning } from '@/utils/toast';
import { CustomTooltip } from './CustomTooltip';
import { projectLabel, useRecentProjects, type RecentProject } from './useRecentProjects';
import styles from './HomeProjects.module.scss';

interface HomeProjectsProps {
  /** Le panneau (verre dessiné dessous par GlassPanelBackdrop) et sa classe, communs aux panneaux de l'Accueil. */
  panelRef: React.RefObject<HTMLDivElement | null>;
  panelClassName: string;
}

const dateOf = (ms: number) => new Date(ms).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

async function open(bytes: Uint8Array, fileName: string) {
  try {
    const count = await openProjectOnPlate(bytes, fileName);
    if (count === 0) showWarning(`Aucun modèle dans « ${fileName} ».`);
  } catch (error) {
    console.error('Ouverture du projet impossible :', error);
    showError(`Le projet « ${fileName} » n'a pas pu être ouvert.`);
  }
}

const openRecent = (project: RecentProject) =>
  void window.apexDesktop?.readProject?.(project.path).then(
    (bytes) => open(bytes, project.name),
    () => showError('Projet introuvable.'),
  );

const Thumbnail: React.FC<{ project: RecentProject }> = ({ project }) => (
  <button type="button" className={styles.card} onClick={() => openRecent(project)}>
    <span className={styles.thumb}>
      {project.thumbnail ? <img src={project.thumbnail} alt="" /> : <span className={styles.placeholder} aria-hidden />}
    </span>
    <span className={styles.name}>{projectLabel(project.name)}</span>
    <span className={styles.date}>{dateOf(project.modified)}</span>
  </button>
);

/** Boutons « Nouveau projet » / « Importer un projet » et miniatures des projets récents de l'Accueil. */
export const HomeProjects: React.FC<HomeProjectsProps> = ({ panelRef, panelClassName }) => {
  const input = useRef<HTMLInputElement>(null);
  const projects = useRecentProjects();

  const onPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!PROJECT_FILE_EXT.test(file.name)) return showWarning('Choisissez un fichier .3mf.');
    await open(new Uint8Array(await file.arrayBuffer()), file.name);
  };

  return (
    <motion.div
      ref={panelRef}
      className={panelClassName}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 16 }}
      transition={{ duration: 0.45, delay: 0.03, ease: [0.16, 1, 0.3, 1] }}
    >
      <h3 className={styles.heading}>Projets</h3>
      <div className={styles.actions}>
        <CustomTooltip
          inline
          content="Nouveau projet"
          description="Ouvre l'espace Préparation sur un plateau vide, prêt à recevoir un modèle."
        >
          <button type="button" className={styles.action} onClick={() => emitApex('apex-go-prepare')}>
            <Plus size={16} /> Nouveau projet
          </button>
        </CustomTooltip>
        <CustomTooltip
          inline
          content="Importer un projet"
          description="Charge un projet au format 3MF : ses modèles sont posés sur le plateau."
        >
          <button type="button" className={styles.action} onClick={() => input.current?.click()}>
            <FolderOpen size={16} /> Importer un projet
          </button>
        </CustomTooltip>
        <input ref={input} type="file" accept=".3mf" hidden onChange={(e) => void onPicked(e)} />
      </div>
      <p className={styles.sub}>Projets récents</p>
      {projects.length === 0 ? (
        <p className={styles.empty}>Aucun projet récent.</p>
      ) : (
        <div className={styles.grid}>
          {projects.map((p) => (
            <Thumbnail key={p.path} project={p} />
          ))}
        </div>
      )}
    </motion.div>
  );
};
