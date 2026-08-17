import React from 'react';
import clsx from 'clsx';
import { HelpCircle, Bell, User, LayoutDashboard, Share2 } from 'lucide-react';
import styles from './TopRightMenu.module.scss';
import { CustomTooltip } from './CustomTooltip';
import { showSuccess } from '@/utils/toast';

export const TopRightMenu: React.FC = () => {
  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <CustomTooltip content="Dashboard / Statistiques">
          <button 
            className={styles.button}
            onClick={() => showSuccess("Ouverture du tableau de bord")}
          >
            <LayoutDashboard size={18} />
          </button>
        </CustomTooltip>

        <CustomTooltip content="Partager le projet">
          <button 
            className={styles.button}
            onClick={() => showSuccess("Lien de partage copié dans le presse-papier !")}
          >
            <Share2 size={18} />
          </button>
        </CustomTooltip>

        <div className={styles.separator} />

        <CustomTooltip content="Notifications">
          <button 
            className={styles.button}
            onClick={() => showSuccess("Aucune nouvelle notification")}
          >
            <Bell size={18} />
          </button>
        </CustomTooltip>

        <CustomTooltip content="Aide & Documentation">
          <button 
            className={styles.button}
            onClick={() => showSuccess("Ouverture de l'aide en ligne")}
          >
            <HelpCircle size={18} />
          </button>
        </CustomTooltip>

        <div className={styles.separator} />

        <CustomTooltip content="Profil utilisateur">
          <button 
            className={styles.button}
            onClick={() => showSuccess("Connecté en tant qu'Utilisateur Apex")}
          >
            <User size={18} />
          </button>
        </CustomTooltip>
      </div>
    </div>
  );
};