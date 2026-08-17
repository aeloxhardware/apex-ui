import React from 'react';
import clsx from 'clsx';
import { 
  HelpCircle, 
  Bell, 
  User, 
  LayoutDashboard, 
  Share2, 
  Sliders, 
  Cpu, 
  Layers, 
  Zap 
} from 'lucide-react';
import styles from './TopRightMenu.module.scss';
import { CustomTooltip } from './CustomTooltip';
import { showSuccess } from '@/utils/toast';

export const TopRightMenu: React.FC = () => {
  return (
    <div className={styles.container}>
      {/* Menu principal d'origine */}
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

      {/* Second menu en dessous avec hauteur 2.5x */}
      <div className={clsx(styles.toolbar, styles.secondaryToolbar)}>
        <CustomTooltip content="Paramètres Rapides">
          <button 
            className={clsx(styles.button, styles.largeButton)}
            onClick={() => showSuccess("Paramètres rapides ouverts")}
          >
            <Sliders size={28} />
            <span>Réglages</span>
          </button>
        </CustomTooltip>

        <CustomTooltip content="Processeur & IA">
          <button 
            className={clsx(styles.button, styles.largeButton)}
            onClick={() => showSuccess("Module IA actif")}
          >
            <Cpu size={28} />
            <span>Processeur</span>
          </button>
        </CustomTooltip>

        <div className={styles.largeSeparator} />

        <CustomTooltip content="Profils Multicouches">
          <button 
            className={clsx(styles.button, styles.largeButton)}
            onClick={() => showSuccess("Profils de couches avancés")}
          >
            <Layers size={28} />
            <span>Couches</span>
          </button>
        </CustomTooltip>

        <CustomTooltip content="Turbo Boost Slicing">
          <button 
            className={clsx(styles.button, styles.largeButton)}
            onClick={() => showSuccess("Mode Turbo Boost activé")}
          >
            <Zap size={28} className="text-amber-400 fill-amber-400/20" />
            <span>Turbo</span>
          </button>
        </CustomTooltip>
      </div>
    </div>
  );
};