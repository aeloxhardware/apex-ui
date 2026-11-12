import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { IconFilterCheck, IconFilterPlus, IconFilterX } from '@tabler/icons-react';
import { GlassPanel } from './GlassPanel';
import { usePortalRoot } from './GpuWarningFrame';
import { bottomTip } from './edit-node/bottomTooltip';
import { FilamentFilterPanel, NO_FILTERS, matchesFilters, type FilamentFilter } from './FilamentFilterPanel';
import { filamentKey, loadFilaments, type FilamentProfile } from '@/utils/filamentCatalog';
import { useUserFilaments } from '@/utils/userFilaments';
import styles from './FilamentSelector.module.scss';

const MAX_SHOWN = 80;
/** Apparition en cascade (glissement + fondu vers l'extérieur) : décalage par ligne, plafonné. */
const cascade = (i: number) => ({
  initial: { opacity: 0, x: -14 },
  animate: { opacity: 1, x: 0 },
  transition: { duration: 0.3, delay: 0.05 + Math.min(i, 12) * 0.03, ease: [0.16, 1, 0.3, 1] as const },
});

interface FilterHistory {
  filters: FilamentFilter[];
  past: FilamentFilter[][];
  future: FilamentFilter[][];
}

/** Ctrl+Z → annuler ; Ctrl+Y ou Ctrl+Maj+Z → rétablir ; sinon rien. */
function undoRedoOf(e: KeyboardEvent): 'undo' | 'redo' | null {
  if (!(e.ctrlKey || e.metaKey)) return null;
  const k = e.key.toLowerCase();
  if (k === 'y' || (k === 'z' && e.shiftKey)) return 'redo';
  return k === 'z' ? 'undo' : null;
}

/** Dans le champ de recherche, tant qu'il contient du texte, Ctrl+Z / Ctrl+Y gardent leur rôle de saisie. */
const typingInSearch = (e: KeyboardEvent): boolean => e.target instanceof HTMLInputElement && e.target.value !== '';

/** Historique après annulation / rétablissement, ou `null` s'il n'y a rien à annuler / rétablir. */
function stepHistory(h: FilterHistory, action: 'undo' | 'redo'): FilterHistory | null {
  if (action === 'undo') {
    if (h.past.length === 0) return null;
    return { filters: h.past[h.past.length - 1], past: h.past.slice(0, -1), future: [h.filters, ...h.future] };
  }
  if (h.future.length === 0) return null;
  return { filters: h.future[0], past: [...h.past, h.filters], future: h.future.slice(1) };
}

/** Filtres posés par l'utilisateur, avec un historique (Ctrl+Z / Ctrl+Y) tant que la liste `open` reste ouverte. */
function useFilterHistory(open: boolean) {
  const [hist, setHist] = useState<FilterHistory>({ filters: NO_FILTERS, past: [], future: [] });
  const histRef = useRef(hist);
  histRef.current = hist;
  const filters = hist.filters;
  const commitFilters = (next: FilamentFilter[]) => setHist((h) => ({ filters: next, past: [...h.past, h.filters], future: [] }));
  useEffect(() => {
    if (open) return;
    // Liste refermée : les filtres restent, mais on ne peut plus annuler / rétablir leurs modifications.
    setHist((h) => ({ filters: h.filters, past: [], future: [] }));
  }, [open]);

  // Annuler / rétablir l'ajout, le retrait ou le changement de mode d'un filtre.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const action = undoRedoOf(e);
      if (!action || typingInSearch(e)) return;
      const next = stepHistory(histRef.current, action);
      if (!next) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setHist(next);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);
  return { filters, commitFilters };
}

/** Pastilles des filtres actifs : clic = inverser inclusif / exclusif, croix = supprimer. */
const FilterChips: React.FC<{ filters: FilamentFilter[]; commitFilters: (next: FilamentFilter[]) => void }> = ({
  filters,
  commitFilters,
}) => (
  <div className={styles.chips}>
    {filters.map((filter) => {
      const exclude = filter.mode === 'exclude';
      const Icon = exclude ? IconFilterX : IconFilterCheck;
      return (
        <span key={`${filter.kind}:${filter.value}`} className={exclude ? `${styles.chip} ${styles.chipExclude}` : styles.chip}>
          <button
            type="button"
            className={styles.chipBody}
            {...bottomTip(
              exclude ? 'Filtre exclusif' : 'Filtre inclusif',
              exclude
                ? 'Filtre exclusif masquant les éléments correspondant à ses critères. Cliquez pour le rendre inclusif. Cliquez sur la croix pour le supprimer.'
                : "Filtre inclusif n'affichant que les éléments correspondant à ses critères. Cliquez pour le rendre exclusif. Cliquez sur la croix pour le supprimer.",
            )}
            onClick={() => commitFilters(filters.map((x) => (x === filter ? { ...x, mode: exclude ? 'include' : 'exclude' } : x)))}
          >
            <Icon size={13} stroke={1.75} />
            <span className={styles.chipLabel}>
              {filter.kind === 'brand' ? 'Marque' : 'Matériau'} : {filter.value}
            </span>
          </button>
          <button
            type="button"
            className={styles.chipClose}
            aria-label="Supprimer le filtre"
            {...bottomTip('Supprimer', 'Supprimer ce filtre.')}
            onClick={() => commitFilters(filters.filter((x) => x !== filter))}
          >
            <X size={10} />
          </button>
        </span>
      );
    })}
  </div>
);

/** Liste des filaments affichés (au plus `MAX_SHOWN`) ; un clic sélectionne et referme. */
const FilamentList: React.FC<{
  error: string | null;
  shown: FilamentProfile[];
  selectedKey: string | undefined;
  onPick: (key: string) => void;
}> = ({ error, shown, selectedKey, onPick }) => (
  <ul className={styles.list}>
    {error && <li className={styles.empty}>{error}</li>}
    {!error && shown.length === 0 && <li className={styles.empty}>Aucun filament</li>}
    {shown.map((f, i) => {
      const key = filamentKey(f);
      return (
        <motion.li key={key} {...cascade(i + 1)}>
          <button
            type="button"
            className={key === selectedKey ? `${styles.item} ${styles.itemActive}` : styles.item}
            {...bottomTip(
              f.name,
              `Sélectionner ce filament${key === selectedKey ? ' (déjà sélectionné)' : ''} : ${[f.vendor, f.type].filter(Boolean).join(' · ')}.`,
            )}
            onClick={() => onPick(key)}
          >
            <span>{f.name}</span>
            <span className={styles.itemMeta}>{[f.vendor, f.type].filter(Boolean).join(' · ')}</span>
          </button>
        </motion.li>
      );
    })}
    {!error && shown.length === MAX_SHOWN && <li className={styles.empty}>Affinez la recherche pour voir la suite.</li>}
  </ul>
);

type ElementRef = React.RefObject<HTMLElement | null> | undefined;
const contains = (ref: ElementRef, target: Node): boolean => ref?.current?.contains(target) ?? false;

/** Un clic hors du menu le ferme (et le panneau de filtre avec) ; Échap ferme d'abord le panneau de filtre, puis la liste. */
function useMenuDismiss(p: {
  open: boolean;
  filterOpen: boolean;
  setFilterOpen: (open: boolean) => void;
  onClose: () => void;
  popupRef: ElementRef;
  filterRef: ElementRef;
  filterButtonRef: ElementRef;
  ignoreRef: ElementRef;
}) {
  const { open, filterOpen, setFilterOpen, onClose, popupRef, filterRef, filterButtonRef, ignoreRef } = p;
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      const inFilter = contains(filterRef, t) || contains(filterButtonRef, t);
      if (!inFilter) setFilterOpen(false);
      if (!inFilter && !contains(ignoreRef, t) && !contains(popupRef, t)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (filterOpen) setFilterOpen(false);
      else onClose();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, filterOpen, setFilterOpen, onClose, popupRef, filterRef, filterButtonRef, ignoreRef]);
}

export interface FilamentPickerMenuProps {
  open: boolean;
  /** Coin haut-gauche du menu, dans le repère de la zone de l'interface. */
  anchor: { left: number; top: number };
  selectedKey?: string | undefined;
  /** Ajoute les profils de l'utilisateur (copies modifiées) en tête de la liste. */
  includeUser?: boolean;
  /** Élément qui ouvre le menu : un clic dessus n'est pas un clic « à côté ». */
  ignoreRef?: React.RefObject<HTMLElement | null> | undefined;
  onPick: (key: string) => void;
  onClose: () => void;
}

/**
 * Menu de choix d'un filament (recherche, filtre marque / matériau, liste du catalogue Orca) : celui de l'espace
 * Préparation, réutilisé partout où l'on choisit un filament. Un clic hors du menu ou Échap le ferme.
 */
export const FilamentPickerMenu: React.FC<FilamentPickerMenuProps> = ({
  open,
  anchor,
  selectedKey,
  includeUser = false,
  ignoreRef,
  onPick,
  onClose,
}) => {
  const [filaments, setFilaments] = useState<FilamentProfile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const popupRef = useRef<HTMLDivElement | null>(null);
  // Filtre par marque / matériau : panneau latéral à droite de la liste, filtres appliqués au clic sur « OK ».
  const portalRoot = usePortalRoot();
  const filterRef = useRef<HTMLDivElement | null>(null);
  const filterButtonRef = useRef<HTMLButtonElement | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterAnchor, setFilterAnchor] = useState({ left: 0, top: 0 });
  const userProfiles = useUserFilaments();
  // Liste refermée : le panneau de filtre se referme aussi, la recherche est vidée.
  useEffect(() => {
    if (!open) {
      setFilterOpen(false);
      setQuery('');
    }
  }, [open]);
  const { filters, commitFilters } = useFilterHistory(open);
  // Les calques `position: fixed` se repèrent sur la zone de l'interface (bandeau ancré au-dessus), pas sur la fenêtre.
  const zoneOrigin = () => (portalRoot === document.body ? { left: 0, top: 0 } : portalRoot.getBoundingClientRect());

  useEffect(() => {
    let cancelled = false;
    loadFilaments()
      .then((l) => {
        if (!cancelled) setFilaments(l);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e.message ?? e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useMenuDismiss({ open, filterOpen, setFilterOpen, onClose, popupRef, filterRef, filterButtonRef, ignoreRef });

  const library = useMemo(() => (includeUser ? [...userProfiles, ...filaments] : filaments), [includeUser, userProfiles, filaments]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = library.filter(
      (f) => matchesFilters(f, filters) && (!q || `${f.name} ${f.vendor} ${f.type ?? ''}`.toLowerCase().includes(q)),
    );
    return list.slice(0, MAX_SHOWN);
  }, [library, query, filters]);

  return (
    <>
      <GlassPanel portal open={open} ref={popupRef} className={styles.popup} style={{ left: anchor.left, top: anchor.top }}>
        <motion.div {...cascade(0)} className={styles.searchRow}>
          <input
            autoFocus
            className={styles.search}
            {...bottomTip('Recherche', 'Rechercher un filament par son nom, sa marque ou sa matière.')}
            placeholder="Rechercher un filament (nom, marque, matière)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            ref={filterButtonRef}
            type="button"
            className={filterOpen || filters.length > 0 ? `${styles.filterButton} ${styles.filterActive}` : styles.filterButton}
            aria-label="Filtrer par marque ou par matériau"
            {...bottomTip('Filtrer', 'Filtrer la liste par marque ou par matériau.')}
            onClick={() => {
              const r = popupRef.current?.getBoundingClientRect();
              if (r) {
                const o = zoneOrigin();
                setFilterAnchor({ left: r.right + 12 - o.left, top: r.top - o.top });
              }
              setFilterOpen((v) => !v);
            }}
          >
            <IconFilterPlus size={16} stroke={1.75} />
          </button>
        </motion.div>
        <FilterChips filters={filters} commitFilters={commitFilters} />
        <FilamentList error={error} shown={shown} selectedKey={selectedKey} onPick={onPick} />
      </GlassPanel>
      <FilamentFilterPanel
        ref={filterRef}
        open={open && filterOpen}
        style={{ left: filterAnchor.left, top: filterAnchor.top }}
        filaments={library}
        applied={filters}
        onApply={(f) => {
          commitFilters(f);
          setFilterOpen(false);
        }}
        onClose={() => setFilterOpen(false)}
      />
    </>
  );
};
