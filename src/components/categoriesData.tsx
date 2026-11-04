import React, {  } from 'react';
import {
  Layers,
  BicepsFlexed,
  Gauge,
  Sparkles,
  Terminal} from 'lucide-react';

// Icône personnalisée "Supports" : barres verticales évoquant une structure de support
export const SupportsIcon = () => (
  <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 4v16M10.5 4v16M15 4v16M19 4v16" />
  </svg>
);

export interface CategoryItem {
  id: string;
  title: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  disabled?: boolean;
  sections: {
    title: string;
    /** `engine` : chemin du réglage du moteur auquel la ligne est reliée (ligne active, cf. EngineItemRow). */
    items: { label: string; defaultValue: string; description: string; engine?: string }[];
  }[];
}

export const DESC_ORCA = 'Réglage d’OrcaSlicer, pas encore pris en charge par le moteur d’Apex.';

export const CATEGORIES: CategoryItem[] = [
  {
    id: 'quality',
    title: 'Quality (Qualité)',
    label: 'Qualité',
    description: 'Paramétrez la hauteur de couche, la vitesse globale, la précision des parois, les porte-à-faux, la couture et la compensation d’isolation.',
    icon: <Sparkles size={20} />,
    sections: [
      {
        title: 'Hauteur de couche',
        items: [
          { label: 'Hauteur de couche', defaultValue: '', description: '', engine: 'layers.layer_height_base' },
          { label: 'Hauteur de couche initiale', defaultValue: '0,2 mm', description: DESC_ORCA }
        ]
      },
      {
        title: 'Largeur de ligne',
        items: [
          { label: 'Défaut', defaultValue: '0,4 mm', description: DESC_ORCA },
          { label: 'Couche initiale', defaultValue: '0,5 mm', description: DESC_ORCA },
          { label: 'Paroi extérieure', defaultValue: '0,4 mm', description: DESC_ORCA },
          { label: 'Paroi intérieure', defaultValue: '0,45 mm', description: DESC_ORCA },
          { label: 'Surface supérieure', defaultValue: '0,4 mm', description: DESC_ORCA },
          { label: 'Remplissage', defaultValue: '0,45 mm', description: DESC_ORCA },
          { label: 'Remplissage plein interne', defaultValue: '0,4 mm', description: DESC_ORCA },
          { label: 'Supports', defaultValue: '0,4 mm', description: DESC_ORCA },
          { label: 'Pont', defaultValue: '100%', description: DESC_ORCA }
        ]
      },
      {
        title: 'Couture',
        items: [
          { label: 'Position de la couture', defaultValue: 'Alignée', description: DESC_ORCA },
          { label: 'Coutures intérieures décalées', defaultValue: 'Désactivé', description: DESC_ORCA },
          { label: 'Écart de couture', defaultValue: '10%', description: DESC_ORCA },
          { label: 'Couture en biseau (beta)', defaultValue: 'Aucun', description: DESC_ORCA },
          { label: 'Vitesse d’essuyage en fonction de la vitesse d’extrusion', defaultValue: 'Activé', description: DESC_ORCA },
          { label: 'Vitesse d’essuyage', defaultValue: '80%', description: DESC_ORCA },
          { label: 'Essuyer sur les boucles', defaultValue: 'Désactivé', description: DESC_ORCA },
          { label: 'Essuyer avant la boucle externe', defaultValue: 'Désactivé', description: DESC_ORCA }
        ]
      },
      {
        title: 'Précision',
        items: [
          { label: 'Rayon de fermeture de l’écart des tranches', defaultValue: '0,049 mm', description: DESC_ORCA },
          { label: 'Résolution', defaultValue: '0,012 mm', description: DESC_ORCA }
        ]
      }
    ]
  },
  {
    id: 'strength',
    title: 'Strength (Solidité)',
    label: 'Solidité',
    description: 'Configurez les parois, les coques, le remplissage et l’ancrage des structures.',
    icon: <BicepsFlexed size={20} />,
    sections: [
      {
        title: 'Parois & coques',
        items: [
          { label: 'Nombre de parois', defaultValue: '', description: '', engine: 'toolpath2d.wall_count' },
          { label: 'Couches supérieures / inférieures (Top / Bottom shells)', defaultValue: '4', description: 'Nombre de couches pleines formant le dessus et le dessous de la pièce.' }
        ]
      },
      {
        title: 'Remplissage & ancrage',
        items: [
          { label: 'Densité de remplissage', defaultValue: '', description: '', engine: 'toolpath2d.infill_density' },
          { label: 'Motif de remplissage', defaultValue: '', description: '', engine: 'toolpath2d.infill_pattern' },
          { label: 'Parois d’ancrage des ponts', defaultValue: '', description: '', engine: 'toolpath2d.bridge_anchor_extra_walls' }
        ]
      }
    ]
  },
  {
    id: 'speed',
    title: 'Speed (Vitesse)',
    label: 'Vitesse',
    description: 'Réglez l’accélération, les vitesses spécifiques et la vitesse de rétraction.',
    icon: <Gauge size={20} />,
    sections: [
      {
        title: 'Accélération & vitesses',
        items: [
          { label: 'Vitesse d’impression', defaultValue: '', description: '', engine: 'gcode_params.print_speed' },
          { label: 'Accélération', defaultValue: '5000 mm/s²', description: 'Vitesse à laquelle la tête atteint sa consigne.' },
          { label: 'Vitesse des parois externes', defaultValue: '80 mm/s', description: 'Vitesse des contours visibles.' },
          { label: 'Vitesse des parois internes', defaultValue: '120 mm/s', description: 'Vitesse des contours internes.' },
          { label: 'Vitesse du premier niveau', defaultValue: '30 mm/s', description: 'Vitesse dédiée à la première couche pour améliorer l’adhérence.' },
          { label: 'Vitesse du remplissage', defaultValue: '200 mm/s', description: 'Vitesse d’impression de la structure interne.' },
          { label: 'Vitesse de détection des ponts', defaultValue: '50 mm/s', description: 'Vitesse utilisée pour les zones de ponts.' }
        ]
      },
      {
        title: 'Déplacements',
        items: [
          { label: 'Vitesse de déplacement', defaultValue: '', description: '', engine: 'gcode_params.travel_speed' },
          { label: 'Dégagement', defaultValue: '', description: '', engine: 'gcode_params.travel_clearance' },
          { label: 'Limite de rotation cumulée du plateau', defaultValue: '', description: '', engine: 'gcode_params.max_y_turns' }
        ]
      },
      {
        title: 'Rétraction',
        items: [
          { label: 'Vitesse de rétraction', defaultValue: '35 mm/s', description: 'Vitesse de recul du filament pendant les déplacements.' },
          { label: 'Longueur de rétraction', defaultValue: '', description: '', engine: 'gcode_params.retract_length' }
        ]
      }
    ]
  },
  {
    id: 'support',
    title: 'Support (Support & Adhérence)',
    label: 'Supports',
    description: 'Configurez les supports, leurs interfaces et l’adhérence au plateau.',
    icon: <SupportsIcon />,
    sections: [
      {
        title: 'Supports',
        items: [
          { label: 'Activer les supports', defaultValue: 'Activé', description: 'Active la génération de supports sous les zones en porte-à-faux.' },
          { label: 'Type de support', defaultValue: 'Tree', description: 'Choisit entre supports normaux et supports arborescents (Tree).' },
          { label: 'Style de support', defaultValue: 'Organique', description: 'Définit la forme et la stratégie de génération des supports.' },
          { label: 'Angle de déclenchement', defaultValue: '45°', description: 'Angle au-delà duquel un support est généré.' }
        ]
      },
      {
        title: 'Interfaces & adhérence',
        items: [
          { label: 'Distance d’interface Z', defaultValue: '0.2 mm', description: 'Écart vertical entre la pièce et l’interface du support.' },
          { label: 'Distance d’interface X/Y', defaultValue: '0.35 mm', description: 'Écart horizontal entre la pièce et le support.' },
          { label: 'Type de bordure (Brim / Raft)', defaultValue: 'Brim', description: 'Augmente la surface de contact avec le plateau pour améliorer l’adhérence.' }
        ]
      }
    ]
  },
  {
    id: 'others',
    title: 'Others (Autres)',
    label: 'Autre',
    description: 'Regroupez les options avancées, la ventilation fine, la purge multi-couleurs et les scripts.',
    icon: <Layers size={20} />,
    sections: [
      {
        title: 'Impression & ventilation',
        items: [
          { label: 'Température', defaultValue: '', description: '', engine: 'gcode_params.nozzle_temp' },
          { label: 'Mode vase (Spiral vase)', defaultValue: 'Désactivé', description: 'Imprime les parois en spirale continue pour les objets adaptés.' },
          { label: 'Ordre d’impression des objets', defaultValue: 'Séquentiel', description: 'Définit l’ordre dans lequel les objets sont imprimés.' },
          { label: 'Stratégie de ventilation fine', defaultValue: 'Automatique', description: 'Ajuste finement le refroidissement selon la géométrie et la couche.' }
        ]
      },
      {
        title: 'Multi-couleurs & scripts',
        items: [
          { label: 'Purge / tour de rinçage', defaultValue: '600 mm³', description: 'Gère la purge de matière lors des changements de couleur.' },
          { label: 'Scripts d’I/O (G-code personnalisé)', defaultValue: 'Standard', description: 'Personnalise les commandes exécutées au début, à la fin ou pendant une pause.' }
        ]
      }
    ]
  },
  {
    id: 'others-gcode',
    title: 'Others/G-code (Flotteurs spécifiques)',
    label: 'G-code spécifique',
    description: 'Regroupez les paramètres d’exclusion d’objets, de pauses intermédiaires et d’optimisation de trajectoire.',
    icon: <Terminal size={20} />,
    sections: [
      {
        title: 'Paramètres spécifiques',
        items: [
          { label: 'Exclusion d’objets', defaultValue: 'Désactivée', description: 'Permet d’exclure certains objets du plateau pendant la préparation ou l’impression.' },
          { label: 'Pauses intermédiaires', defaultValue: 'Aucune', description: 'Insère des pauses à des hauteurs ou étapes définies.' },
          { label: 'Optimisation de trajectoire', defaultValue: 'Activée', description: 'Réduit les déplacements inutiles et optimise les trajectoires générées.' }
        ]
      }
    ]
  }
];
