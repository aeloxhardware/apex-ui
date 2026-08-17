import React, { useState } from 'react';
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
import { showSuccess } from '@/utils/toast';

interface ItemInfo {
  title: string;
  description: string;
}

export const TopRightMenu: React.FC = () => {
  const [hoveredInfo, setHoveredInfo] = useState<ItemInfo | null>(null);

  const handleMouseEnter = (title: string, description: string) => {
    setHoveredInfo({ title, description });
  };

  const handleMouseLeave = () => {
    setHoveredInfo(null);
  };

  return (
    <div className={styles.container}>
      {/* Affichage dynamique du titre et de la description au survol */}
      <div className={styles.infoBox}>
        {hoveredInfo ? (
          <>
            <span className={styles.infoTitle}>{hoveredInfo.title}</span>
            <span className={styles.infoDesc}>{hoveredInfo.description}</span>
          </>
        ) : (
          <span className={styles.infoPlaceholder}>Survolez un élément pour afficher ses détails</span>
        )}
      </div>

      {/* Menu principal d'origine */}
      <div className={styles.toolbar}>
        <button 
          className={styles.button}
          onClick={() => showSuccess("Ouverture du tableau de bord")}
          onMouseEnter={() => handleMouseEnter("Tableau de bord", "Visualisez les statistiques globales et l'historique de vos impressions.")}
          onMouseLeave={handleMouseLeave}
        >
          <LayoutDashboard size={18} />
        </button>

        <button 
          className={styles.button}
          onClick={() => showSuccess("Lien de partage copié dans le presse-papier !")}
          onMouseEnter={() => handleMouseEnter("Partage", "Générez un lien rapide pour partager votre configuration de projet.")}
          onMouseLeave={handleMouseLeave}
        >
          <Share2 size={18} />
        </button>

        <div className={styles.separator} />

        <button 
          className={styles.button}
          onClick={() => showSuccess("Aucune nouvelle notification")}
          onMouseEnter={() => handleMouseEnter("Notifications", "Consultez les alertes système et les avertissements de l'imprimante.")}
          onMouseLeave={handleMouseLeave}
        >
          <Bell size={18} />
        </button>

        <button 
          className={styles.button}
          onClick={() => showSuccess("Ouverture de l'aide en ligne")}
          onMouseEnter={() => handleMouseEnter("Aide & Support", "Accédez à la documentation officielle et aux tutoriels d'impression.")}
          onMouseLeave={handleMouseLeave}
        >
          <HelpCircle size={18} />
        </button>

        <div className={styles.separator} />

        <button 
          className={styles.button}
          onClick={() => showSuccess("Connecté en tant qu'Utilisateur Apex")}
          onMouseEnter={() => handleMouseEnter("Profil Utilisateur", "Gérez vos préférences de compte, abonnements et clés API.")}
          onMouseLeave={handleMouseLeave}
        >
          <User size={18} />
        </button>
      </div>

      {/* Second menu en dessous avec hauteur 2.5x */}
      <div className={clsx(styles.toolbar, styles.secondaryToolbar)}>
        <button 
          className={clsx(styles.button, styles.largeButton)}
          onClick={() => showSuccess("Paramètres rapides ouverts")}
          onMouseEnter={() => handleMouseEnter("Réglages Rapides", "Modifiez à la volée les paramètres essentiels de la trancheuse.")}
          onMouseLeave={handleMouseLeave}
        >
          <Sliders size={28} />
          <span>Réglages</span>
        </button>

        <button 
          className={clsx(styles.button, styles.largeButton)}
          onClick={() => showSuccess("Module IA actif")}
          onMouseEnter={() => handleMouseEnter("Processeur IA", "Optimisation intelligente des trajectoires et détection des défauts.")}
          onMouseLeave={handleMouseLeave}
        >
          <Cpu size={28} />
          <span>Processeur</span>
        </button>

        <div className={styles.largeSeparator} />

        <button 
          className={clsx(styles.button, styles.largeButton)}
          onClick={() => showSuccess("Profils de couches avancés")}
          onMouseEnter={() => handleMouseEnter("Profils Multicouches", "Configurez des modificateurs de géométrie par zone et par couche.")}
          onMouseLeave={handleMouseLeave}
        >
          <Layers size={28} />
          <span>Couches</span>
        </button>

        <button 
          className={clsx(styles.button, styles.largeButton)}
          onClick={() => showSuccess("Mode Turbo Boost activé")}
          onMouseEnter={() => handleMouseEnter("Turbo Boost Slicing", "Accélération maximale du calcul de découpe grâce au multi-threading.")}
          onMouseLeave={handleMouseLeave}
        >
          <Zap size={28} />
          <span>Turbo</span>
        </button>
      </div>
    </div>
  );
};