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

interface MenuItemData {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  isLarge?: boolean;
}

export const TopRightMenu: React.FC = () => {
  const [hoveredTitle, setHoveredTitle] = useState("Sélectionnez ou survolez un outil");
  const [hoveredDesc, setHoveredDesc] = useState("Les détails s'afficheront ici en temps réel.");

  const topItems = [
    { id: 'dashboard', title: 'Tableau de bord', desc: 'Consultez les statistiques et rapports globaux de fabrication.', icon: <LayoutDashboard size={18} /> },
    { id: 'share', title: 'Partager le projet', desc: 'Générez et copiez un lien d\'accès rapide pour collaborer.', icon: <Share2 size={18} /> },
    { id: 'notif', title: 'Notifications', desc: 'Visualisez les alertes de maintenance et alertes système.', icon: <Bell size={18} /> },
    { id: 'help', title: 'Aide & Documentation', desc: 'Accédez aux manuels d\'utilisation et guides de dépannage.', icon: <HelpCircle size={18} /> },
    { id: 'profile', title: 'Profil utilisateur', desc: 'Gérez vos préférences de compte et jetons d\'authentification.', icon: <User size={18} /> },
  ];

  const bottomItems = [
    { id: 'sliders', title: 'Réglages rapides', desc: 'Modifiez instantanément les paramètres d\'impression courants.', icon: <Sliders size={26} /> },
    { id: 'cpu', title: 'Processeur & IA', desc: 'Surveillez la charge de calcul neuronale et l\'optimisation des trajectoires.', icon: <Cpu size={26} /> },
    { id: 'layers', title: 'Profils Multicouches', desc: 'Configurez les variations d\'épaisseur et liaisons inter-couches.', icon: <Layers size={26} /> },
    { id: 'turbo', title: 'Turbo Boost Slicing', desc: 'Accélérez la génération des passes G-code par calcul parallèle.', icon: <Zap size={26} /> },
  ];

  const handleReset = () => {
    setHoveredTitle("Sélectionnez ou survolez un outil");
    setHoveredDesc("Les détails s'afficheront ici en temps réel.");
  };

  return (
    <div className={styles.container}>
      {/* Menu du haut : Affiche le titre en grand au survol */}
      <div className={styles.toolbar} onMouseLeave={handleReset}>
        <div className={styles.infoDisplayTop}>
          {hoveredTitle}
        </div>
        <div className={styles.separator} />
        {topItems.map((item, idx) => (
          <React.Fragment key={item.id}>
            <button 
              className={styles.button}
              onMouseEnter={() => {
                setHoveredTitle(item.title);
                setHoveredDesc(item.desc);
              }}
              onClick={() => showSuccess(`${item.title} action exécutée`)}
            >
              {item.icon}
            </button>
            {idx < topItems.length - 1 && idx !== 1 && idx !== 3 && <div className={styles.separator} />}
          </React.Fragment>
        ))}
      </div>

      {/* Second menu en dessous : Affiche la description au survol */}
      <div className={clsx(styles.toolbar, styles.secondaryToolbar)} onMouseLeave={handleReset}>
        <div className={styles.infoDisplayBottom}>
          {hoveredDesc}
        </div>
        <div className={styles.separator} />
        {bottomItems.map((item, idx) => (
          <React.Fragment key={item.id}>
            <button 
              className={clsx(styles.button, styles.largeButton)}
              onMouseEnter={() => {
                setHoveredTitle(item.title);
                setHoveredDesc(item.desc);
              }}
              onClick={() => showSuccess(`${item.title} activé`)}
            >
              {item.icon}
              <span>{item.title.split(' ')[0]}</span>
            </button>
            {idx < bottomItems.length - 1 && <div className={styles.largeSeparator} />}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};