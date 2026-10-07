import React, { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { motion, AnimatePresence } from 'framer-motion';
import { Printer, Check, ChevronRight, ArrowLeft, X } from 'lucide-react';
import { CustomTooltip } from './CustomTooltip';
import styles from './PrinterConfigSidebar.module.scss';
import { showSuccess } from '@/utils/toast';
import { PrinterDetailModal } from './PrinterDetailModal';
import { scanProfiles, type ProfileFolder } from '@/utils/printerProfiles';

// Le menu est un navigateur du dossier `profiles/` (cf. electron/profiles.cjs) : une colonne par
// niveau de dossier, une imprimante = un .json (+ photo .png) ; la fiche s'ouvre après la dernière colonne.
const COLUMN_LEFT = 200;
const COLUMN_WIDTH = 195;
const COLUMN_GAP = 12;
const columnLeft = (index: number) => COLUMN_LEFT + index * (COLUMN_WIDTH + COLUMN_GAP);

// Fabricants dont le menu affiche un avis à la place des imprimantes (clé : dossier du catalogue).
const MANUFACTURER_NOTICES: Record<string, { title: string; message: React.ReactNode }> = {
  'Bambu Lab': {
    title: "Les pousses de bambou crues, c'est pas bon à la santé",
    message: (
      <>
        En raison de mises à jour extrêmement restrictives de l'écosystème Bambu Lab ainsi que de leurs{' '}
        <span className={styles.noticeKitsch}>Conditions d'Utilisation</span>, nous estimons judicieux de limiter le
        développement des modules relatifs au fonctionnement d'Apex avec les imprimantes fabriquées par la manufacture
        Bambu Lab afin de concentrer toutes nos ressources de développement sur l'algorithme principal d'Apex Slicer.
      </>
    ),
  },
};

const IDLE_BEFORE_QUIP_MS = 3000;
const QUIP_VISIBLE_MS = 1500;
const NOTICE_QUIP = "ouais, là ils sont devenus encore pire qu'Apple, moi c'est bon merci au revoir, plus envie de me faire chier avec leurs conneries. Merci Bambu ! --Romain PRAS";

/** Avis d'un fabricant ; une souris immobile 3 s dessus fait apparaître 1,5 s une petite infobulle. */
const NoticePanel: React.FC<{ left: number; title: string; message: React.ReactNode }> = ({ left, title, message }) => {
  const [quip, setQuip] = useState<{ x: number; y: number } | null>(null);
  const idleTimer = useRef<number | undefined>(undefined);
  const hideTimer = useRef<number | undefined>(undefined);

  const clearTimers = () => {
    window.clearTimeout(idleTimer.current);
    window.clearTimeout(hideTimer.current);
  };
  useEffect(() => clearTimers, []);

  // Chaque mouvement masque l'infobulle et relance le décompte ; elle ne revient qu'après un nouveau mouvement.
  const onMove = (e: React.MouseEvent) => {
    clearTimers();
    setQuip(null);
    const { clientX: x, clientY: y } = e;
    idleTimer.current = window.setTimeout(() => {
      setQuip({ x, y });
      hideTimer.current = window.setTimeout(() => setQuip(null), QUIP_VISIBLE_MS);
    }, IDLE_BEFORE_QUIP_MS);
  };
  const onLeave = () => { clearTimers(); setQuip(null); };

  return (
    <motion.div
      className={styles.noticePanel}
      style={{ left }}
      initial={{ opacity: 0, scale: 0.95, x: -15 }}
      animate={enterAnimation}
      exit={columnExit}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
    >
      <h4 className={styles.noticeTitle}>{title}</h4>
      <p className={styles.noticeText}>{message}</p>
      {quip && (
        <div className={styles.noticeQuip} style={{ left: quip.x + 14, top: quip.y + 18 }}>{NOTICE_QUIP}</div>
      )}
    </motion.div>
  );
};

const enterAnimation = { opacity: 1, scale: 1, x: 0, transition: { duration: 0.25, ease: [0.16, 1, 0.3, 1] as const } };
const columnExit = { opacity: 0, x: -20, transition: { opacity: { duration: 0.2, ease: 'linear' as const }, x: { duration: 0.2, ease: 'easeInOut' as const } } };

interface ProfileColumnProps {
  index: number;
  title: string;
  folder: ProfileFolder;
  openFolder?: string;
  activePrinterPath?: string;
  selectedPrinter: string;
  collapsing?: boolean;
  onOpenFolder: (name: string) => void;
  onOpenPrinter: (printer: { name: string; path: string }) => void;
}

/** Une colonne du menu : sous-dossiers puis imprimantes d'un dossier, avec sa barre de défilement. */
const ProfileColumn: React.FC<ProfileColumnProps> = ({
  index, title, folder, openFolder, activePrinterPath, selectedPrinter, collapsing, onOpenFolder, onOpenPrinter,
}) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState({ height: 40, top: 8, visible: false });
  const [dragging, setDragging] = useState(false);

  const updateThumb = () => {
    const el = contentRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    if (scrollHeight <= clientHeight) {
      setThumb((t) => (t.visible ? { ...t, visible: false } : t));
      return;
    }
    const margin = 8;
    const track = clientHeight - margin * 2;
    const height = Math.max(32, (clientHeight / scrollHeight) * track);
    const maxScroll = scrollHeight - clientHeight;
    const top = margin + (scrollTop / maxScroll) * (track - height);
    setThumb({ height, top, visible: true });
  };

  useEffect(() => {
    const id = setTimeout(updateThumb, 50);
    return () => clearTimeout(id);
  }, [folder]);

  const startDrag = (e: React.MouseEvent) => {
    const el = contentRef.current;
    if (!el) return;
    setDragging(true);
    const startY = e.clientY;
    const startScroll = el.scrollTop;
    const onMove = (ev: MouseEvent) => {
      const { scrollHeight, clientHeight } = el;
      const maxThumbTop = clientHeight - 16 - thumb.height;
      if (maxThumbTop <= 0) return;
      const maxScroll = scrollHeight - clientHeight;
      el.scrollTop = Math.max(0, Math.min(maxScroll, startScroll + ((ev.clientY - startY) / maxThumbTop) * maxScroll));
      updateThumb();
    };
    const onUp = () => {
      setDragging(false);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    e.preventDefault();
  };

  const isFirst = index === 0;
  const empty = folder.folders.length === 0 && folder.printers.length === 0;

  return (
    <motion.div
      className={isFirst ? styles.fusionMenuContainer : styles.patternPopup}
      style={isFirst ? undefined : { left: columnLeft(index) }}
      initial={isFirst ? { opacity: 0, scale: 0.95, x: -15, y: 20 } : { opacity: 0, scale: 0.95, x: -15 }}
      animate={collapsing
        ? { opacity: 0, x: -20, transition: { opacity: { duration: 0.2, ease: 'linear' }, x: { duration: 0.2, ease: 'easeInOut' } } }
        : { ...enterAnimation, y: 0 }}
      exit={isFirst ? { opacity: 0, scale: 0.95, x: -15, y: 20 } : columnExit}
    >
      <div
        ref={contentRef}
        className={isFirst ? styles.fusionMenuContent : styles.patternPopupContent}
        onScroll={() => { if (!dragging) updateThumb(); }}
      >
        <div className={styles.sectionGroup}>
          <h4 className={styles.sectionTitle}>{title}</h4>
          <ul className={styles.itemsList}>
            {empty && <li className={styles.itemName} style={{ opacity: 0.5, padding: '6px 10px' }}>Dossier vide</li>}
            {folder.folders.map((sub, idx) => (
              <motion.div
                key={sub.path}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.15, delay: Math.min(idx, 12) * 0.03 }}
              >
                <CustomTooltip content={sub.name} description="">
                  <li
                    className={clsx(isFirst ? styles.itemRow : styles.patternItem, {
                      [isFirst ? styles.activeRow : styles.activePattern]: openFolder === sub.name,
                    })}
                    onClick={() => onOpenFolder(sub.name)}
                  >
                    <span className={styles.itemName}>{sub.name}</span>
                    <ChevronRight size={14} className="text-zinc-400 shrink-0" />
                  </li>
                </CustomTooltip>
              </motion.div>
            ))}
            {folder.printers.map((printer, idx) => {
              const isActive = activePrinterPath === printer.path;
              const isSelected = selectedPrinter === printer.name;
              return (
                <motion.div
                  key={printer.path}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.15, delay: Math.min(folder.folders.length + idx, 12) * 0.03 }}
                >
                  <CustomTooltip content={printer.name} description="Cliquez pour afficher les informations techniques de l'imprimante.">
                    <li
                      className={clsx(isFirst ? styles.itemRow : styles.patternItem, {
                        [isFirst ? styles.activeRow : styles.activePattern]: isActive || isSelected,
                      })}
                      onClick={() => onOpenPrinter(printer)}
                    >
                      <span className={styles.itemName}>{printer.name}</span>
                      {isActive
                        ? <ChevronRight size={14} className="text-[#00f0ff] shrink-0" />
                        : isSelected && <Check size={14} className="text-[#00f0ff] shrink-0" />}
                    </li>
                  </CustomTooltip>
                </motion.div>
              );
            })}
          </ul>
        </div>
      </div>

      {thumb.visible && (
        <div
          className={clsx(styles.externalScrollThumb, { [styles.dragging]: dragging })}
          onMouseDown={startDrag}
          style={{ height: `${thumb.height}px`, top: `${thumb.top}px` }}
        />
      )}
    </motion.div>
  );
};

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
  const [tree, setTree] = useState<ProfileFolder | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  // Noms des dossiers ouverts, du premier niveau au plus profond.
  const [folderPath, setFolderPath] = useState<string[]>([]);
  const [activePrinter, setActivePrinter] = useState<{ name: string; path: string } | null>(null);

  // Séquence de fermeture jouée après la sélection d'une imprimante : chaque niveau de
  // sous-menu se réduit (fondu + glissement) l'un après l'autre, puis la base et enfin le
  // bandeau chemin d'accès (celui-ci vers le bas).
  const [baseCollapsing, setBaseCollapsing] = useState(false);
  const [breadcrumbCollapsing, setBreadcrumbCollapsing] = useState(false);

  // Le dossier est relu à chaque ouverture du menu : un profil ajouté ou modifié apparaît sans redémarrage.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    scanProfiles()
      .then((t) => { if (!cancelled) { setTree(t); setScanError(null); } })
      .catch((err) => { if (!cancelled) setScanError(err instanceof Error ? err.message : String(err)); });
    return () => { cancelled = true; };
  }, [isOpen]);

  // Dossiers parcourus : chain[0] = racine, chain[k] = dossier ouvert à la colonne k-1.
  const chain: ProfileFolder[] = [];
  if (tree) {
    chain.push(tree);
    for (const name of folderPath) {
      const next = chain[chain.length - 1].folders.find((f) => f.name === name);
      if (!next) break;
      chain.push(next);
    }
  }

  // Un dossier doté d'un avis n'ouvre pas sa colonne : l'avis s'affiche à sa place.
  const noticeIndex = chain.findIndex((f, i) => i > 0 && f.name in MANUFACTURER_NOTICES);
  const notice = noticeIndex > 0 ? MANUFACTURER_NOTICES[chain[noticeIndex].name] : null;
  if (noticeIndex > 0) chain.length = noticeIndex;

  const runClosingSequence = () => {
    const STAGGER = 50;
    const FADE = 200;
    let t = 0;
    setActivePrinter(null);
    for (let depth = folderPath.length - 1; depth >= 0; depth--) {
      setTimeout(() => setFolderPath((p) => p.slice(0, depth)), t);
      t += STAGGER;
    }
    setTimeout(() => setBaseCollapsing(true), t); t += STAGGER;
    const afterBase = t + FADE;
    setTimeout(() => setBreadcrumbCollapsing(true), afterBase);
    setTimeout(() => {
      onClose();
      setBaseCollapsing(false);
      setBreadcrumbCollapsing(false);
    }, afterBase + FADE);
  };

  const handleSelectPrinter = (name: string) => {
    onSelectPrinter(name);
    showSuccess(`Imprimante active : ${name}`);
    runClosingSequence();
  };

  const openFolder = (depth: number, name: string) => {
    setFolderPath((p) => [...p.slice(0, depth), name]);
    setActivePrinter(null);
  };

  const openPrinter = (depth: number, printer: { name: string; path: string }) => {
    setFolderPath((p) => p.slice(0, depth));
    setActivePrinter(printer);
  };

  const goBack = () => {
    if (activePrinter) setActivePrinter(null);
    else setFolderPath((p) => p.slice(0, -1));
  };

  const columnCount = chain.length;
  const slotCount = columnCount + (activePrinter || notice ? 1 : 0);
  const titlePath = folderPath.length
    ? `Profils imprimante\\[${chain.slice(1).map((f) => f.name).join(' > ')}]`
    : 'Profils imprimante';
  const canGoBack = folderPath.length > 0 || !!activePrinter;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            className={styles.fusionTitleContainer}
            style={{ width: COLUMN_WIDTH + (Math.max(slotCount, 1) - 1) * (COLUMN_WIDTH + COLUMN_GAP) }}
            data-apex-chrome-panel
            initial={{ opacity: 0, scale: 0.95, x: -10, y: -20 }}
            animate={breadcrumbCollapsing
              ? { opacity: 0, y: 20, transition: { opacity: { duration: 0.2, ease: 'linear' }, y: { duration: 0.2, ease: 'easeInOut' } } }
              : { opacity: 1, scale: 1, x: 0, y: 0, transition: { duration: 0.25, ease: [0.16, 1, 0.3, 1] } }}
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
                  onClick={goBack}
                  disabled={!canGoBack}
                  style={!canGoBack ? { opacity: 0.3, cursor: 'not-allowed' } : {}}
                >
                  <ArrowLeft size={16} />
                </button>
              </CustomTooltip>

              <CustomTooltip content="Fermer le menu" description="Fermer complètement le panneau de configuration des imprimantes.">
                <button
                  className={styles.fusionCloseBtn}
                  onClick={() => {
                    setActivePrinter(null);
                    onClose();
                  }}
                >
                  <X size={16} />
                </button>
              </CustomTooltip>
            </div>
          </motion.div>

          {!tree && (
            <motion.div
              className={styles.fusionMenuContainer}
              initial={{ opacity: 0, scale: 0.95, x: -15, y: 20 }}
              animate={{ ...enterAnimation, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, x: -15, y: 20 }}
            >
              <div className={styles.fusionMenuContent}>
                <div className={styles.sectionGroup}>
                  <h4 className={styles.sectionTitle}>Fabricants</h4>
                  <ul className={styles.itemsList}>
                    <li className={styles.itemName} style={{ opacity: 0.6, padding: '6px 10px' }}>
                      {scanError ? `Profils illisibles : ${scanError}` : 'Chargement…'}
                    </li>
                  </ul>
                </div>
              </div>
            </motion.div>
          )}

          <AnimatePresence>
          {chain.map((folder, depth) => (
            <ProfileColumn
              key={folder.path || 'root'}
              index={depth}
              title={depth === 0 ? 'Fabricants' : folder.name}
              folder={folder}
              openFolder={folderPath[depth]}
              activePrinterPath={depth === columnCount - 1 ? activePrinter?.path : undefined}
              selectedPrinter={selectedPrinter}
              collapsing={depth === 0 && baseCollapsing}
              onOpenFolder={(name) => openFolder(depth, name)}
              onOpenPrinter={(printer) => openPrinter(depth, printer)}
            />
          ))}
          </AnimatePresence>

          <AnimatePresence>
            {notice && (
              <NoticePanel key="manufacturer-notice" left={columnLeft(columnCount)} title={notice.title} message={notice.message} />
            )}
          </AnimatePresence>

          <PrinterDetailModal
            printer={activePrinter}
            left={columnLeft(columnCount)}
            onClose={() => setActivePrinter(null)}
            onSelect={handleSelectPrinter}
          />
        </>
      )}
    </AnimatePresence>
  );
};
