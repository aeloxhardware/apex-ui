import React, { useRef, useState, useEffect } from 'react';
import clsx from 'clsx';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Printer, 
  Check,
  ChevronRight,
  ArrowLeft,
  X
} from 'lucide-react';
import { CustomTooltip } from './CustomTooltip';
import styles from './PrinterConfigSidebar.module.scss';
import { showSuccess } from '@/utils/toast';

export interface PrinterModel {
  id: string;
  name: string;
}

export interface SubCategory {
  id: string;
  name: string;
  models: PrinterModel[];
}

export interface SpecificManufacturer {
  id: string;
  name: string;
  models?: PrinterModel[];
  subCategories?: SubCategory[];
  nestedCategories?: {
    id: string;
    name: string;
    subCategories: SubCategory[];
  }[];
}

export interface PrinterCategory {
  id: string;
  name: string;
  isDirectList?: boolean;
  disabled?: boolean;
  models?: PrinterModel[];
  manufacturers?: SpecificManufacturer[];
}

export const PRINTER_CATEGORIES: PrinterCategory[] = [
  {
    id: 'aelox',
    name: 'Aelox Hardware',
    isDirectList: true,
    models: [
      { id: 'aelox-fusion-pro', name: 'Aelox Fusion Pro' },
      { id: 'aelox-compact', name: 'Aelox Compact X' }
    ]
  },
  {
    id: 'autres',
    name: 'Autres fabricants',
    disabled: true,
    manufacturers: [
      {
        id: '3d-systems',
        name: '3D Systems',
        models: [
          { id: 'prox-dp-200', name: 'ProX DMP 200' },
          { id: 'prox-dp-320', name: 'ProX DMP 320' },
          { id: 'figure-4-standalone', name: 'Figure 4 Standalone' },
          { id: 'sla-750', name: 'SLA 750' }
        ]
      },
      {
        id: '3dceram',
        name: '3DCeram',
        models: [
          { id: 'ceramo-bot', name: 'CeraBot' },
          { id: 'hot-lithography-1000', name: 'CeraFab System 1000' }
        ]
      },
      {
        id: 'addup',
        name: 'AddUp',
        models: [
          { id: 'formup-350', name: 'FormUp 350' },
          { id: 'beamo-addup', name: 'BeAM Modulo 400' }
        ]
      },
      {
        id: 'anycubic',
        name: 'Anycubic',
        models: [
          { id: 'kobra-2-pro', name: 'Kobra 2 Pro' },
          { id: 'kobra-3-combo', name: 'Kobra 3 Combo' },
          { id: 'photon-mono-m5s', name: 'Photon Mono M5s' },
          { id: 'photon-m3-max', name: 'Photon M3 Max' }
        ]
      },
      {
        id: 'artillery',
        name: 'Artillery 3D',
        models: [
          { id: 'sidewinder-x4-pro', name: 'Sidewinder X4 Pro' },
          { id: 'genius-pro', name: 'Genius Pro' },
          { id: 'hornet', name: 'Hornet' }
        ]
      },
      {
        id: 'asiga',
        name: 'Asiga',
        models: [
          { id: 'max-uv', name: 'ASIGA MAX UV' },
          { id: 'pro-4k', name: 'ASIGA PRO 4K' }
        ]
      },
      {
        id: 'bambu-lab',
        name: 'Bambu Lab',
        models: [
          { id: 'bambu-x1c', name: 'X1 Carbon' },
          { id: 'bambu-x1e', name: 'X1E Enterprise' },
          { id: 'bambu-p1s', name: 'P1S' },
          { id: 'bambu-p1p', name: 'P1P' },
          { id: 'bambu-a1', name: 'A1' },
          { id: 'bambu-a1-mini', name: 'A1 Mini' }
        ]
      },
      {
        id: 'carbon',
        name: 'Carbon',
        models: [
          { id: 'm1', name: 'Carbon M1' },
          { id: 'm2', name: 'Carbon M2' },
          { id: 'm3', name: 'Carbon M3' }
        ]
      },
      {
        id: 'creality',
        name: 'Creality',
        nestedCategories: [
          {
            id: 'creality-ender',
            name: 'Série Ender',
            subCategories: [
              {
                id: 'ender-3',
                name: 'Ender-3',
                models: [
                  { id: 'e3', name: 'Ender-3' },
                  { id: 'e3-pro', name: 'Ender-3 Pro' },
                  { id: 'e3-v2', name: 'Ender-3 V2' },
                  { id: 'e3-max', name: 'Ender-3 Max' },
                  { id: 'e3-s1', name: 'Ender-3 S1' },
                  { id: 'e3-s1-pro', name: 'Ender-3 S1 Pro' },
                  { id: 'e3-s1-plus', name: 'Ender-3 S1 Plus' },
                  { id: 'e3-neo', name: 'Ender-3 Neo' },
                  { id: 'e3-v2-neo', name: 'Ender-3 V2 Neo' },
                  { id: 'e3-max-neo', name: 'Ender-3 Max Neo' },
                  { id: 'e3-v3-se', name: 'Ender-3 V3 SE' },
                  { id: 'e3-v3-ke', name: 'Ender-3 V3 KE' },
                  { id: 'e3-v3', name: 'Ender-3 V3' },
                  { id: 'e3-v3-plus', name: 'Ender-3 V3 Plus' }
                ]
              },
              {
                id: 'ender-5',
                name: 'Ender-5',
                models: [
                  { id: 'e5', name: 'Ender-5' },
                  { id: 'e5-pro', name: 'Ender-5 Pro' },
                  { id: 'e5-plus', name: 'Ender-5 Plus' },
                  { id: 'e5-s1', name: 'Ender-5 S1' }
                ]
              },
              {
                id: 'ender-6-7',
                name: 'Ender-6 / Ender-7',
                models: [
                  { id: 'e6', name: 'Ender-6' },
                  { id: 'e7', name: 'Ender-7' }
                ]
              },
              {
                id: 'autres-ender',
                name: 'Autres Ender',
                models: [
                  { id: 'e2', name: 'Ender-2' },
                  { id: 'e2-pro', name: 'Ender-2 Pro' },
                  { id: 'e4', name: 'Ender-4' }
                ]
              }
            ]
          },
          {
            id: 'creality-k',
            name: 'Série K (CoreXY Haute Vitesse)',
            subCategories: [
              {
                id: 'k-series',
                name: 'Modèles K',
                models: [
                  { id: 'k1', name: 'K1' },
                  { id: 'k1-max', name: 'K1 Max' },
                  { id: 'k1c', name: 'K1C' },
                  { id: 'k2-plus', name: 'K2 Plus' }
                ]
              }
            ]
          },
          {
            id: 'creality-cr',
            name: 'Série CR (Core / Cartésiennes Grand Format)',
            subCategories: [
              {
                id: 'cr-10',
                name: 'CR-10',
                models: [
                  { id: 'cr10', name: 'CR-10' },
                  { id: 'cr10s', name: 'CR-10S' },
                  { id: 'cr10-s4', name: 'CR-10 S4' },
                  { id: 'cr10-s5', name: 'CR-10 S5' },
                  { id: 'cr10-v2', name: 'CR-10 V2' },
                  { id: 'cr10-v3', name: 'CR-10 V3' },
                  { id: 'cr10-max', name: 'CR-10 Max' },
                  { id: 'cr10-mini', name: 'CR-10 Mini' },
                  { id: 'cr10-smart', name: 'CR-10 Smart' },
                  { id: 'cr10-smart-pro', name: 'CR-10 Smart Pro' },
                  { id: 'cr10-se', name: 'CR-10 SE' }
                ]
              },
              {
                id: 'cr-6',
                name: 'CR-6',
                models: [
                  { id: 'cr6-se', name: 'CR-6 SE' },
                  { id: 'cr6-max', name: 'CR-6 Max' }
                ]
              },
              {
                id: 'cr-20',
                name: 'CR-20',
                models: [
                  { id: 'cr20', name: 'CR-20' },
                  { id: 'cr20-pro', name: 'CR-20 Pro' }
                ]
              },
              {
                id: 'cr-m4',
                name: 'CR-M4',
                models: [
                  { id: 'crm4', name: 'CR-M4' }
                ]
              },
              {
                id: 'cr-x',
                name: 'CR-X',
                models: [
                  { id: 'crx', name: 'CR-X' },
                  { id: 'crx-pro', name: 'CR-X Pro' }
                ]
              },
              {
                id: 'autres-cr',
                name: 'Autres CR',
                models: [
                  { id: 'cr30', name: 'CR-30 (PrintMill)' },
                  { id: 'cr100', name: 'CR-100' },
                  { id: 'cr2020', name: 'CR-2020' },
                  { id: 'cr3040', name: 'CR-3040' },
                  { id: 'cr3040-pro', name: 'CR-3040 Pro' },
                  { id: 'cr5-pro', name: 'CR-5 Pro' },
                  { id: 'cr5-pro-ht', name: 'CR-5 Pro High-Temp' }
                ]
              }
            ]
          },
          {
            id: 'creality-resin',
            name: 'Série Résine (SLA / LCD - Halot & LD)',
            subCategories: [
              {
                id: 'halot',
                name: 'Gamme Halot',
                models: [
                  { id: 'halot-one', name: 'Halot-One' },
                  { id: 'halot-one-plus', name: 'Halot-One Plus' },
                  { id: 'halot-one-pro', name: 'Halot-One Pro' },
                  { id: 'halot-mage', name: 'Halot-Mage' },
                  { id: 'halot-mage-pro', name: 'Halot-Mage Pro' },
                  { id: 'halot-mage-s', name: 'Halot-Mage S' },
                  { id: 'halot-sky', name: 'Halot-Sky' },
                  { id: 'halot-sky-2022', name: 'Halot-Sky 2022' },
                  { id: 'halot-lite', name: 'Halot-Lite' },
                  { id: 'halot-ray', name: 'Halot-Ray' },
                  { id: 'halot-max', name: 'Halot-Max' }
                ]
              },
              {
                id: 'ld',
                name: 'Gamme LD (Archivée)',
                models: [
                  { id: 'ld-001', name: 'LD-001' },
                  { id: 'ld-002', name: 'LD-002' },
                  { id: 'ld-002r', name: 'LD-002R' },
                  { id: 'ld-002h', name: 'LD-002H' },
                  { id: 'ld-006', name: 'LD-006' }
                ]
              }
            ]
          },
          {
            id: 'creality-enclosed',
            name: 'Séries Caisson Fermé / Éducation',
            subCategories: [
              {
                id: 'sermoon',
                name: 'Série Sermoon',
                models: [
                  { id: 'sermoon-d1', name: 'Sermoon D1' },
                  { id: 'sermoon-d3', name: 'Sermoon D3' },
                  { id: 'sermoon-d3-pro', name: 'Sermoon D3 Pro' },
                  { id: 'sermoon-v1', name: 'Sermoon V1' },
                  { id: 'sermoon-v1-pro', name: 'Sermoon V1 Pro' }
                ]
              },
              {
                id: 'cr-200',
                name: 'Série CR-200',
                models: [
                  { id: 'cr-200b', name: 'CR-200B' },
                  { id: 'cr-200b-pro', name: 'CR-200B Pro' }
                ]
              }
            ]
          },
          {
            id: 'creality-multi',
            name: 'Série Beluga / Multi-couleurs',
            subCategories: [
              {
                id: 'cfs',
                name: 'Système Multi-filaments',
                models: [
                  { id: 'cfs-system', name: 'CFS (system multi-filaments)' }
                ]
              }
            ]
          },
          {
            id: 'creality-special',
            name: 'Imprimantes Spéciales / Archivées',
            subCategories: [
              {
                id: 'special',
                name: 'Modèles Spéciaux',
                models: [
                  { id: 'cr-8', name: 'CR-8' },
                  { id: 'cr-7', name: 'CR-7' }
                ]
              }
            ]
          }
        ]
      },
      {
        id: 'dagoma',
        name: 'Dagoma',
        models: [
          { id: 'magis', name: 'Magis' },
          { id: 'sigma', name: 'Sigma' },
          { id: 'ultimate', name: 'Ultimate' }
        ]
      },
      {
        id: 'desktop-metal',
        name: 'Desktop Metal',
        models: [
          { id: 'shop-system', name: 'Shop System' },
          { id: 'production-system', name: 'Production System' },
          { id: 'studio-system-2', name: 'Studio System 2' }
        ]
      },
      {
        id: 'elegoo',
        name: 'Elegoo',
        models: [
          { id: 'neptune-4-max', name: 'Neptune 4 Max' },
          { id: 'neptune-4-pro', name: 'Neptune 4 Pro' },
          { id: 'saturn-3-ultra', name: 'Saturn 3 Ultra' },
          { id: 'mars-4-ultra', name: 'Mars 4 Ultra' }
        ]
      },
      {
        id: 'eos',
        name: 'EOS',
        models: [
          { id: 'eos m 290', name: 'EOS M 290' },
          { id: 'eos m 400', name: 'EOS M 400' },
          { id: 'eos formiga p 110', name: 'EOS Formiga P 110' }
        ]
      },
      {
        id: 'flashforge',
        name: 'Flashforge',
        models: [
          { id: 'creator-3-pro', name: 'Creator 3 Pro' },
          { id: 'adventurer-5m-pro', name: 'Adventurer 5M Pro' },
          { id: 'guider-3', name: 'Guider 3' }
        ]
      },
      {
        id: 'flsun',
        name: 'FLSUN',
        models: [
          { id: 'flsun-t1', name: 'FLSUN T1' },
          { id: 'flsun-v400', name: 'FLSUN V400' },
          { id: 'flsun-s1', name: 'FLSUN S1' }
        ]
      },
      {
        id: 'formlabs',
        name: 'Formlabs',
        models: [
          { id: 'form-4', name: 'Form 4' },
          { id: 'form-4l', name: 'Form 4L' },
          { id: 'form-3+', name: 'Form 3+' },
          { id: 'form-fuse-1', name: 'Fuse 1+' }
        ]
      },
      {
        id: 'hp',
        name: 'HP Inc.',
        models: [
          { id: 'jet-fusion-5200', name: 'Jet Fusion 5200' },
          { id: 'jet-fusion-4200', name: 'Jet Fusion 4200' },
          { id: 'jet-fusion-580', name: 'Jet Fusion 580' }
        ]
      },
      {
        id: 'lynxter',
        name: 'Lynxter',
        models: [
          { id: 's600d', name: 'S600D' },
          { id: 's300x', name: 'S300X' }
        ]
      },
      {
        id: 'markforged',
        name: 'Markforged',
        models: [
          { id: 'mark-two', name: 'Mark Two' },
          { id: 'x7', name: 'X7' },
          { id: 'fx20', name: 'FX20' },
          { id: 'metal-x', name: 'Metal X' }
        ]
      },
      {
        id: 'phrozen',
        name: 'Phrozen',
        models: [
          { id: 'sonic-mega-8k-s', name: 'Sonic Mega 8K S' },
          { id: 'sonic-mighty-8k', name: 'Sonic Mighty 8K' },
          { id: 'revo', name: 'Revo' }
        ]
      },
      {
        id: 'prodways',
        name: 'Prodways Group',
        models: [
          { id: 'proMaker-ld-series', name: 'ProMaker LD Series' },
          { id: 'promaker-p-series', name: 'ProMaker P Series' }
        ]
      },
      {
        id: 'prusa-research',
        name: 'Prusa Research',
        models: [
          { id: 'prusa-mk4', name: 'Original Prusa MK4' },
          { id: 'prusa-xl', name: 'Original Prusa XL' },
          { id: 'prusa-mini+', name: 'Original Prusa MINI+' }
        ]
      },
      {
        id: 'qidi-tech',
        name: 'QIDI Tech',
        models: [
          { id: 'qidi-q1-pro', name: 'QIDI Q1 Pro' },
          { id: 'qidi-max-3', name: 'QIDI Max 3' },
          { id: 'qidi-plus-3', name: 'QIDI Plus 3' }
        ]
      },
      {
        id: 'raise3d',
        name: 'Raise3D',
        models: [
          { id: 'pro3', name: 'Pro3' },
          { id: 'pro3-plus', name: 'Pro3 Plus' },
          { id: 'rtof-m3', name: 'RMF500' }
        ]
      },
      {
        id: 'snapmaker',
        name: 'Snapmaker',
        models: [
          { id: 'snapmaker-artisan', name: 'Artisan 3-in-1' },
          { id: 'snapmaker-2-0', name: 'Snapmaker 2.0 A350T' },
          { id: 'ray', name: 'Ray' }
        ]
      },
      {
        id: 'sovol',
        name: 'Sovol 3D',
        models: [
          { id: 'sv07-plus', name: 'SV07 Plus' },
          { id: 'sv06-plus', name: 'SV06 Plus' }
        ]
      },
      {
        id: 'stratasys',
        name: 'Stratasys',
        models: [
          { id: 'fortus-450mc', name: 'Fortus 450mc' },
          { id: 'f123-series', name: 'F123 Series' },
          { id: 'origin-one', name: 'Origin One' }
        ]
      },
      {
        id: 'ultimaker',
        name: 'UltiMaker',
        models: [
          { id: 'ultimaker-s7', name: 'UltiMaker S7' },
          { id: 'ultimaker-s5', name: 'UltiMaker S5' },
          { id: 'method-x', name: 'METHOD X' }
        ]
      },
      {
        id: 'volumic',
        name: 'Volumic 3D',
        models: [
          { id: 'stream-30-pro-mk3', name: 'Stream 30 Pro MK3' },
          { id: 'stream-multix', name: 'Stream MultiX' }
        ]
      },
      {
        id: 'zortrax',
        name: 'Zortrax',
        models: [
          { id: 'm300-dual', name: 'M300 Dual' },
          { id: 'inventure', name: 'Inventure' },
          { id: 'endure-300', name: 'Endure 300' }
        ]
      }
    ]
  }
];

interface PrinterConfigSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  selectedPrinter: string;
  onSelectPrinter: (printerName: string) => void;
  selectedFilament: string;
  onSelectFilament: (filamentName: string) => void;
}

export const PrinterConfigSidebar: React.FC<PrinterConfigSidebarProps> = ({
  isOpen,
  onClose,
  selectedPrinter,
  onSelectPrinter,
}) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const midContentRef = useRef<HTMLDivElement>(null);
  const modelsContentRef = useRef<HTMLDivElement>(null);
  const fourthContentRef = useRef<HTMLDivElement>(null);

  const [thumbHeight, setThumbHeight] = useState(40);
  const [thumbTop, setThumbTop] = useState(8);
  const [hasScroll, setHasScroll] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const [midThumbHeight, setMidThumbHeight] = useState(40);
  const [midThumbTop, setMidThumbTop] = useState(8);
  const [hasMidScroll, setHasMidScroll] = useState(false);
  const [isMidDragging, setIsMidDragging] = useState(false);

  const [modelsThumbHeight, setModelsThumbHeight] = useState(40);
  const [modelsThumbTop, setModelsThumbTop] = useState(8);
  const [hasModelsScroll, setHasModelsScroll] = useState(false);
  const [isModelsDragging, setIsModelsDragging] = useState(false);

  const [fourthThumbHeight, setFourthThumbHeight] = useState(40);
  const [fourthThumbTop, setFourthThumbTop] = useState(8);
  const [hasFourthScroll, setHasFourthScroll] = useState(false);
  const [isFourthDragging, setIsFourthDragging] = useState(false);

  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedManufacturer, setSelectedManufacturer] = useState<string | null>(null);
  const [selectedNestedCat, setSelectedNestedCat] = useState<string | null>(null);
  const [selectedSubCat, setSelectedSubCat] = useState<string | null>(null);

  const startYRef = useRef(0);
  const startScrollTopRef = useRef(0);

  const handleScroll = (ref: React.RefObject<HTMLDivElement | null>, setThumbH: (n: number) => void, setThumbT: (n: number) => void, setHasS: (b: boolean) => void, isDrag: boolean) => {
    if (!ref.current || isDrag) return;
    const { scrollTop, scrollHeight, clientHeight } = ref.current;
    if (scrollHeight <= clientHeight) {
      setHasS(false);
      return;
    }
    setHasS(true);
    
    const margin = 8;
    const trackHeight = clientHeight - (margin * 2);
    const calculatedHeight = Math.max(32, (clientHeight / scrollHeight) * trackHeight);
    
    const maxScrollTop = scrollHeight - clientHeight;
    const maxThumbTop = trackHeight - calculatedHeight;
    const calculatedTop = maxScrollTop > 0 ? margin + (scrollTop / maxScrollTop) * maxThumbTop : margin;

    setThumbH(calculatedHeight);
    setThumbT(calculatedTop);
  };

  const handleMouseDown = (e: React.MouseEvent, type: 'cat' | 'mid' | 'models' | 'fourth') => {
    if (type === 'cat') setIsDragging(true);
    if (type === 'mid') setIsMidDragging(true);
    if (type === 'models') setIsModelsDragging(true);
    if (type === 'fourth') setIsFourthDragging(true);

    startYRef.current = e.clientY;
    const currentRef = type === 'cat' ? contentRef : type === 'mid' ? midContentRef : type === 'models' ? modelsContentRef : fourthContentRef;
    if (currentRef.current) {
      startScrollTopRef.current = currentRef.current.scrollTop;
    }

    const onMouseMove = (ev: MouseEvent) => {
      const refObj = type === 'cat' ? contentRef : type === 'mid' ? midContentRef : type === 'models' ? modelsContentRef : fourthContentRef;
      const thumbH = type === 'cat' ? thumbHeight : type === 'mid' ? midThumbHeight : type === 'models' ? modelsThumbHeight : fourthThumbHeight;
      if (!refObj.current) return;
      const deltaY = ev.clientY - startYRef.current;
      const { scrollHeight, clientHeight } = refObj.current;
      const margin = 8;
      const trackHeight = clientHeight - (margin * 2);
      const maxThumbTop = trackHeight - thumbH;
      const maxScrollTop = scrollHeight - clientHeight;

      if (maxThumbTop > 0) {
        const scrollRatio = deltaY / maxThumbTop;
        const newScrollTop = Math.max(0, Math.min(maxScrollTop, startScrollTopRef.current + scrollRatio * maxScrollTop));
        refObj.current.scrollTop = newScrollTop;
      }
    };

    const onMouseUp = () => {
      if (type === 'cat') setIsDragging(false);
      if (type === 'mid') setIsMidDragging(false);
      if (type === 'models') setIsModelsDragging(false);
      if (type === 'fourth') setIsFourthDragging(false);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    e.preventDefault();
  };

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => handleScroll(contentRef, setThumbHeight, setThumbTop, setHasScroll, isDragging), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    if (selectedCategory) {
      setTimeout(() => handleScroll(midContentRef, setMidThumbHeight, setMidThumbTop, setHasMidScroll, isMidDragging), 50);
    }
  }, [selectedCategory]);

  useEffect(() => {
    if (selectedManufacturer) {
      setTimeout(() => handleScroll(modelsContentRef, setModelsThumbHeight, setModelsThumbTop, setHasModelsScroll, isModelsDragging), 50);
    }
  }, [selectedManufacturer]);

  useEffect(() => {
    if (selectedNestedCat) {
      setTimeout(() => handleScroll(fourthContentRef, setFourthThumbHeight, setFourthThumbTop, setHasFourthScroll, isFourthDragging), 50);
    }
  }, [selectedNestedCat]);

  const activeCategoryObj = PRINTER_CATEGORIES.find(c => c.id === selectedCategory);
  const activeManufacturerObj = activeCategoryObj?.manufacturers?.find(m => m.id === selectedManufacturer);
  const activeNestedCatObj = activeManufacturerObj?.nestedCategories?.find(nc => nc.id === selectedNestedCat);
  const activeSubCatObj = activeNestedCatObj?.subCategories?.find(sc => sc.id === selectedSubCat);

  let titlePath = 'Profils imprimante';
  if (activeCategoryObj) {
    if (activeCategoryObj.isDirectList) {
      titlePath = `Profils imprimante\\[${activeCategoryObj.name}]`;
    } else if (activeManufacturerObj) {
      if (activeManufacturerObj.id === 'creality' && selectedNestedCat) {
        if (selectedSubCat) {
          titlePath = `Profils imprimante\\[${activeCategoryObj.name}\\> ${activeManufacturerObj.name}\\> ${activeNestedCatObj?.name}\\> ${activeSubCatObj?.name}]`;
        } else {
          titlePath = `Profils imprimante\\[${activeCategoryObj.name}\\> ${activeManufacturerObj.name}\\> ${activeNestedCatObj?.name}]`;
        }
      } else if (selectedManufacturer) {
        titlePath = `Profils imprimante\\[${activeCategoryObj.name}\\> ${activeManufacturerObj.name}]`;
      } else {
        titlePath = `Profils imprimante\\[${activeCategoryObj.name}]`;
      }
    } else {
      titlePath = `Profils imprimante\\[${activeCategoryObj.name}]`;
    }
  }

  let windowCount = 1;
  if (selectedCategory) {
    if (activeCategoryObj?.isDirectList || (activeManufacturerObj && !activeManufacturerObj.nestedCategories)) {
      windowCount = 2;
    } else if (activeManufacturerObj?.nestedCategories) {
      if (selectedNestedCat) {
        if (selectedSubCat) {
          windowCount = 4;
        } else {
          windowCount = 3;
        }
      } else {
        windowCount = 2;
      }
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div 
            className={clsx(styles.fusionTitleContainer, { 
              [styles.expandedWidthTwo]: windowCount === 2,
              [styles.expandedWidthThree]: windowCount === 3,
              [styles.expandedWidthFour]: windowCount === 4
            })}
            initial={{ opacity: 0, scale: 0.95, x: -10, y: -20 }}
            animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, x: -10, y: -20 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className={styles.tabButtonsContainer}>
              <div className={styles.activeTabTitle}>
                <Printer size={14} className="mr-1.5 inline text-[#00f0ff] shrink-0" /> 
                <span className="truncate">{titlePath}</span>
              </div>
            </div>
            <div className="flex items-center space-x-1 shrink-0">
              <CustomTooltip content="Retour en arrière" description="Revenir au menu précédent dans la hiérarchie des profils d'imprimante.">
                <button 
                  className={styles.fusionCloseBtn}
                  onClick={() => {
                    if (selectedSubCat) {
                      setSelectedSubCat(null);
                    } else if (selectedNestedCat) {
                      setSelectedNestedCat(null);
                    } else if (selectedManufacturer) {
                      setSelectedManufacturer(null);
                    } else if (selectedCategory) {
                      setSelectedCategory(null);
                    }
                  }}
                  disabled={!selectedCategory}
                  style={!selectedCategory ? { opacity: 0.3, cursor: 'not-allowed' } : {}}
                >
                  <ArrowLeft size={16} />
                </button>
              </CustomTooltip>

              <CustomTooltip content="Fermer le menu" description="Fermer complètement le panneau de configuration des imprimantes.">
                <button 
                  className={styles.fusionCloseBtn}
                  onClick={onClose}
                >
                  <X size={16} />
                </button>
              </CustomTooltip>
            </div>
          </motion.div>

          {/* First Window: Categories (Aelox / Autres) */}
          <motion.div 
            className={styles.fusionMenuContainer}
            initial={{ opacity: 0, scale: 0.95, x: -15, y: 20 }}
            animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, x: -15, y: 20 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          >
            <div 
              ref={contentRef}
              className={styles.fusionMenuContent}
              onScroll={() => handleScroll(contentRef, setThumbHeight, setThumbTop, setHasScroll, isDragging)}
            >
              <div className={styles.sectionGroup}>
                <h4 className={styles.sectionTitle}>Fabricants</h4>
                <ul className={styles.itemsList}>
                  {PRINTER_CATEGORIES.map((cat, idx) => {
                    const isSelected = selectedCategory === cat.id;
                    return (
                      <motion.div
                        key={cat.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.2, delay: idx * 0.04 }}
                      >
                        <CustomTooltip 
                          content={cat.disabled ? "Bientôt disponible" : cat.name} 
                          description={cat.disabled ? "Ce fabricant sera disponible dans une prochaine mise à jour." : ""}
                        >
                          <li 
                            className={clsx(styles.itemRow, { 
                              [styles.activeRow]: isSelected,
                              [styles.disabledRow]: cat.disabled
                            })}
                            style={cat.disabled ? { opacity: 0.35, cursor: 'not-allowed' } : {}}
                            onClick={() => {
                              if (cat.disabled) {
                                showSuccess("Bientôt disponible");
                                return;
                              }
                              setSelectedCategory(cat.id);
                              setSelectedManufacturer(null);
                              setSelectedNestedCat(null);
                              setSelectedSubCat(null);
                            }}
                          >
                            <span className={styles.itemName}>{cat.name}</span>
                            {!cat.disabled && <ChevronRight size={14} className="text-zinc-400 shrink-0" />}
                          </li>
                        </CustomTooltip>
                      </motion.div>
                    );
                  })}
                </ul>
              </div>
            </div>

            {hasScroll && (
              <div 
                className={clsx(styles.externalScrollThumb, { [styles.dragging]: isDragging })}
                onMouseDown={(e) => handleMouseDown(e, 'cat')}
                style={{
                  height: `${thumbHeight}px`,
                  top: `${thumbTop}px`
                }}
              />
            )}
          </motion.div>

          {/* Second Window: Direct Models or Specific Manufacturers list */}
          <AnimatePresence>
            {selectedCategory && activeCategoryObj && (
              <motion.div 
                className={styles.patternPopup}
                initial={{ opacity: 0, scale: 0.95, x: -15 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.95, x: -15 }}
                transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              >
                <div 
                  ref={midContentRef}
                  className={styles.patternPopupContent}
                  onScroll={() => handleScroll(midContentRef, setMidThumbHeight, setMidThumbTop, setHasMidScroll, isMidDragging)}
                >
                  <div className={styles.sectionGroup}>
                    <h4 className={styles.sectionTitle}>
                      {activeCategoryObj.isDirectList ? 'Modèles' : 'Fabricants'}
                    </h4>
                    <ul className={styles.itemsList}>
                      {activeCategoryObj.isDirectList ? (
                        activeCategoryObj.models?.map((model, idx) => {
                          const isSelected = selectedPrinter === model.name;
                          return (
                            <motion.div
                              key={model.id}
                              initial={{ opacity: 0, x: -10 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ duration: 0.2, delay: idx * 0.03 }}
                            >
                              <CustomTooltip content={model.name} description="">
                                <li 
                                  className={clsx(styles.patternItem, { [styles.activePattern]: isSelected })}
                                  onClick={() => {
                                    onSelectPrinter(model.name);
                                    showSuccess(`Imprimante active : ${model.name}`);
                                  }}
                                >
                                  <span className={styles.itemName}>{model.name}</span>
                                  {isSelected && <Check size={14} className="text-[#00f0ff] shrink-0" />}
                                </li>
                              </CustomTooltip>
                            </motion.div>
                          );
                        })
                      ) : (
                        activeCategoryObj.manufacturers?.map((manuf, idx) => {
                          const isSelected = selectedManufacturer === manuf.id;
                          return (
                            <motion.div
                              key={manuf.id}
                              initial={{ opacity: 0, x: -10 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ duration: 0.15, delay: idx * 0.02 }}
                            >
                              <CustomTooltip content={manuf.name} description="">
                                <li 
                                  className={clsx(styles.patternItem, { [styles.activePattern]: isSelected })}
                                  onClick={() => {
                                    setSelectedManufacturer(manuf.id);
                                    setSelectedNestedCat(null);
                                    setSelectedSubCat(null);
                                  }}
                                >
                                  <span className={styles.itemName}>{manuf.name}</span>
                                  <ChevronRight size={14} className="text-zinc-400 shrink-0" />
                                </li>
                              </CustomTooltip>
                            </motion.div>
                          );
                        })
                      )}
                    </ul>
                  </div>
                </div>

                {hasMidScroll && (
                  <div 
                    className={clsx(styles.externalScrollThumb, { [styles.dragging]: isMidDragging })}
                    onMouseDown={(e) => handleMouseDown(e, 'mid')}
                    style={{
                      height: `${midThumbHeight}px`,
                      top: `${midThumbTop}px`
                    }}
                  />
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Third Window: Models or Series (e.g. Creality series) */}
          <AnimatePresence>
            {selectedManufacturer && activeManufacturerObj && (
              <motion.div 
                className={styles.thirdPopup}
                initial={{ opacity: 0, scale: 0.95, x: -15 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.95, x: -15 }}
                transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              >
                <div 
                  ref={modelsContentRef}
                  className={styles.patternPopupContent}
                  onScroll={() => handleScroll(modelsContentRef, setModelsThumbHeight, setModelsThumbTop, setHasModelsScroll, isModelsDragging)}
                >
                  <div className={styles.sectionGroup}>
                    <h4 className={styles.sectionTitle}>
                      {activeManufacturerObj.nestedCategories ? 'Séries' : 'Modèles'}
                    </h4>
                    <ul className={styles.itemsList}>
                      {activeManufacturerObj.nestedCategories ? (
                        activeManufacturerObj.nestedCategories.map((nc, idx) => {
                          const isSelected = selectedNestedCat === nc.id;
                          return (
                            <motion.div
                              key={nc.id}
                              initial={{ opacity: 0, x: -10 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ duration: 0.15, delay: idx * 0.03 }}
                            >
                              <CustomTooltip content={nc.name} description="">
                                <li 
                                  className={clsx(styles.patternItem, { [styles.activePattern]: isSelected })}
                                  onClick={() => {
                                    setSelectedNestedCat(nc.id);
                                    setSelectedSubCat(null);
                                  }}
                                >
                                  <span className={styles.itemName}>{nc.name}</span>
                                  <ChevronRight size={14} className="text-zinc-400 shrink-0" />
                                </li>
                              </CustomTooltip>
                            </motion.div>
                          );
                        })
                      ) : (
                        activeManufacturerObj.models?.map((model, idx) => {
                          const isSelected = selectedPrinter === model.name;
                          return (
                            <motion.div
                              key={model.id}
                              initial={{ opacity: 0, x: -10 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ duration: 0.15, delay: idx * 0.03 }}
                            >
                              <CustomTooltip content={model.name} description="">
                                <li 
                                  className={clsx(styles.patternItem, { [styles.activePattern]: isSelected })}
                                  onClick={() => {
                                    onSelectPrinter(model.name);
                                    showSuccess(`Imprimante active : ${model.name}`);
                                  }}
                                >
                                  <span className={styles.itemName}>{model.name}</span>
                                  {isSelected && <Check size={14} className="text-[#00f0ff] shrink-0" />}
                                </li>
                              </CustomTooltip>
                            </motion.div>
                          );
                        })
                      )}
                    </ul>
                  </div>
                </div>

                {hasModelsScroll && (
                  <div 
                    className={clsx(styles.externalScrollThumb, { [styles.dragging]: isModelsDragging })}
                    onMouseDown={(e) => handleMouseDown(e, 'models')}
                    style={{
                      height: `${modelsThumbHeight}px`,
                      top: `${modelsThumbTop}px`
                    }}
                  />
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Fourth Window: Sub-categories (e.g. Ender-3, Ender-5) or Models */}
          <AnimatePresence>
            {selectedNestedCat && activeNestedCatObj && (
              <motion.div 
                className={styles.fourthPopup}
                initial={{ opacity: 0, scale: 0.95, x: -15 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.95, x: -15 }}
                transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              >
                <div 
                  ref={fourthContentRef}
                  className={styles.patternPopupContent}
                  onScroll={() => handleScroll(fourthContentRef, setFourthThumbHeight, setFourthThumbTop, setHasFourthScroll, isFourthDragging)}
                >
                  <div className={styles.sectionGroup}>
                    <h4 className={styles.sectionTitle}>Sous-familles</h4>
                    <ul className={styles.itemsList}>
                      {activeNestedCatObj.subCategories.map((sc, idx) => {
                        const isSelected = selectedSubCat === sc.id;
                        return (
                          <motion.div
                            key={sc.id}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ duration: 0.15, delay: idx * 0.03 }}
                          >
                            <CustomTooltip content={sc.name} description="">
                              <li 
                                className={clsx(styles.patternItem, { [styles.activePattern]: isSelected })}
                                onClick={() => {
                                  setSelectedSubCat(sc.id);
                                }}
                              >
                                <span className={styles.itemName}>{sc.name}</span>
                                <ChevronRight size={14} className="text-zinc-400 shrink-0" />
                              </li>
                            </CustomTooltip>
                          </motion.div>
                        );
                      })}
                    </ul>
                  </div>
                </div>

                {hasFourthScroll && (
                  <div 
                    className={clsx(styles.externalScrollThumb, { [styles.dragging]: isFourthDragging })}
                    onMouseDown={(e) => handleMouseDown(e, 'fourth')}
                    style={{
                      height: `${fourthThumbHeight}px`,
                      top: `${fourthThumbTop}px`
                    }}
                  />
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Fifth Window: Final models if sub-category selected */}
          <AnimatePresence>
            {selectedSubCat && activeSubCatObj && (
              <motion.div 
                className={clsx(styles.fifthPopup, "pointer-events-auto")}
                initial={{ opacity: 0, scale: 0.95, x: -15 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.95, x: -15 }}
                transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className={styles.patternPopupContent}>
                  <div className={styles.sectionGroup}>
                    <h4 className={styles.sectionTitle}>Modèles</h4>
                    <ul className={styles.itemsList}>
                      {activeSubCatObj.models.map((model, idx) => {
                        const isSelected = selectedPrinter === model.name;
                        return (
                          <motion.div
                            key={model.id}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ duration: 0.15, delay: idx * 0.02 }}
                          >
                            <CustomTooltip content={model.name} description="">
                              <li 
                                className={clsx(styles.patternItem, { [styles.activePattern]: isSelected })}
                                onClick={() => {
                                  onSelectPrinter(model.name);
                                  showSuccess(`Imprimante active : ${model.name}`);
                                }}
                              >
                                <span className={styles.itemName}>{model.name}</span>
                                {isSelected && <Check size={14} className="text-[#00f0ff] shrink-0" />}
                              </li>
                            </CustomTooltip>
                          </motion.div>
                        );
                      })}
                    </ul>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </AnimatePresence>
  );
};