import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, type MotionProps } from 'framer-motion';
import { GlassPanel } from './GlassPanel';
import { ChevronRight, X } from 'lucide-react';
import { IconFilterCheck, IconFilterPlus, IconFilterX } from '@tabler/icons-react';
import { usePortalRoot } from './GpuWarningFrame';
import { bottomTip } from './edit-node/bottomTooltip';
import { FilamentFilterPanel, NO_FILTERS, matchesFilters, type FilamentFilter } from './FilamentFilterPanel';
import { CustomTooltip } from './CustomTooltip';
import {
  FILAMENT_CHANGED_EVENT, filamentKey, getSelectedFilamentKey, loadFilaments, setSelectedFilamentKey,
  type FilamentProfile,
} from '@/utils/filamentCatalog';
import styles from './FilamentSelector.module.scss';

const MAX_SHOWN = 80;
/** Apparition en cascade (glissement + fondu vers l'extérieur) : décalage par ligne, plafonné. */
const cascade = (i: number) => ({
  initial: { opacity: 0, x: -14 },
  animate: { opacity: 1, x: 0 },
  transition: { duration: 0.3, delay: 0.05 + Math.min(i, 12) * 0.03, ease: [0.16, 1, 0.3, 1] as const },
});
/** Bord droit du panneau de réglages de CategoriesSidebar (left 24 + largeur 320). */
const MENU_RIGHT_EDGE = 24 + 320;

/** Filtres posés par l'utilisateur, avec un historique (Ctrl+Z / Ctrl+Y) tant que la liste `open` reste ouverte. */
function useFilterHistory(open: boolean) {
  const [hist, setHist] = useState<{ filters: FilamentFilter[]; past: FilamentFilter[][]; future: FilamentFilter[][] }>(
    { filters: NO_FILTERS, past: [], future: [] },
  );
  const histRef = useRef(hist);
  histRef.current = hist;
  const filters = hist.filters;
  const commitFilters = (next: FilamentFilter[]) =>
    setHist((h) => ({ filters: next, past: [...h.past, h.filters], future: [] }));
  useEffect(() => {
    if (open) return;
    // Liste refermée : les filtres restent, mais on ne peut plus annuler / rétablir leurs modifications.
    setHist((h) => ({ filters: h.filters, past: [], future: [] }));
  }, [open]);

  // Ctrl+Z / Ctrl+Y (ou Ctrl+Maj+Z) : annuler / rétablir l'ajout, le retrait ou le changement de mode d'un filtre.
  // Dans le champ de recherche, tant qu'il contient du texte, ils gardent leur rôle de saisie.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      const redo = k === 'y' || (k === 'z' && e.shiftKey);
      const undo = k === 'z' && !e.shiftKey;
      if (!undo && !redo) return;
      const t = e.target;
      if (t instanceof HTMLInputElement && t.value) return;
      const h = histRef.current;
      if (undo ? h.past.length === 0 : h.future.length === 0) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setHist(undo
        ? { filters: h.past[h.past.length - 1], past: h.past.slice(0, -1), future: [h.filters, ...h.future] }
        : { filters: h.future[0], past: [...h.past, h.filters], future: h.future.slice(1) });
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);
  return { filters, commitFilters };
}

/** Pastilles des filtres actifs : clic = inverser inclusif / exclusif, croix = supprimer. */
const FilterChips: React.FC<{ filters: FilamentFilter[]; commitFilters: (next: FilamentFilter[]) => void }> = ({ filters, commitFilters }) => (
    <div className={styles.chips}>
      {filters.map((filter) => {
        const exclude = filter.mode === 'exclude';
        const Icon = exclude ? IconFilterX : IconFilterCheck;
        return (
          <span key={`${filter.kind}:${filter.value}`} className={exclude ? `${styles.chip} ${styles.chipExclude}` : styles.chip}>
            <button
              type="button"
              className={styles.chipBody}
              {...bottomTip(exclude ? 'Filtre exclusif' : 'Filtre inclusif', exclude
                ? "Filtre exclusif masquant les éléments correspondant à ses critères. Cliquez pour le rendre inclusif. Cliquez sur la croix pour le supprimer."
                : "Filtre inclusif n'affichant que les éléments correspondant à ses critères. Cliquez pour le rendre exclusif. Cliquez sur la croix pour le supprimer.")}
              onClick={() => commitFilters(filters.map((x) => (x === filter ? { ...x, mode: exclude ? 'include' : 'exclude' } : x)))}
            >
              <Icon size={13} stroke={1.75} />
              <span className={styles.chipLabel}>{filter.kind === 'brand' ? 'Marque' : 'Matériau'} : {filter.value}</span>
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
  selectedKey: string;
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
            {...bottomTip(f.name, `Sélectionner ce filament${key === selectedKey ? ' (déjà sélectionné)' : ''} : ${[f.vendor, f.type].filter(Boolean).join(' · ')}.`)}
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

/** Sélection du filament (Préparation), sous l'arborescence des modèles : catalogue des profils Orca. */
export const FilamentSelector = React.forwardRef<HTMLDivElement, { motionProps: MotionProps }>(function FilamentSelector({ motionProps }, ref) {
  const [filaments, setFilaments] = useState<FilamentProfile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState(getSelectedFilamentKey);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const [anchor, setAnchor] = useState({ left: 0, top: 0 });
  // Filtre par marque / matériau : panneau latéral à droite de la liste, filtres appliqués au clic sur « OK ».
  const portalRoot = usePortalRoot();
  const filterRef = useRef<HTMLDivElement | null>(null);
  const filterButtonRef = useRef<HTMLButtonElement | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterAnchor, setFilterAnchor] = useState({ left: 0, top: 0 });
  // Liste refermée : le panneau de filtre se referme aussi.
  useEffect(() => { if (!open) setFilterOpen(false); }, [open]);
  // Filtres posés par l'utilisateur, avec un historique (Ctrl+Z / Ctrl+Y) tant que la liste reste ouverte.
  const { filters, commitFilters } = useFilterHistory(open);
  // Les calques `position: fixed` se repèrent sur la zone de l'interface (bandeau ancré au-dessus), pas sur la fenêtre.
  const zoneOrigin = () => (portalRoot === document.body ? { left: 0, top: 0 } : portalRoot.getBoundingClientRect());

  useEffect(() => {
    let cancelled = false;
    loadFilaments().then((l) => { if (!cancelled) setFilaments(l); }).catch((e) => { if (!cancelled) setError(String(e.message ?? e)); });
    const onChanged = (e: Event) => setSelectedKey((e as CustomEvent<{ key: string }>).detail.key);
    window.addEventListener(FILAMENT_CHANGED_EVENT, onChanged);
    return () => { cancelled = true; window.removeEventListener(FILAMENT_CHANGED_EVENT, onChanged); };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      const inFilter = filterRef.current?.contains(t) || filterButtonRef.current?.contains(t);
      if (!inFilter) setFilterOpen(false);
      if (!rootRef.current?.contains(t) && !popupRef.current?.contains(t) && !inFilter) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Échap ferme d'abord le panneau de filtre, puis la liste.
      if (filterOpen) setFilterOpen(false); else setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [open, filterOpen]);



  const selected = filaments.find((f) => filamentKey(f) === selectedKey);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = filaments.filter((f) => matchesFilters(f, filters)
      && (!q || `${f.name} ${f.vendor} ${f.type ?? ''}`.toLowerCase().includes(q)));
    return list.slice(0, MAX_SHOWN);
  }, [filaments, query, filters]);

  const detail = selected
    ? [selected.type, selected.nozzle_temp != null ? `${selected.nozzle_temp} °C` : null].filter(Boolean).join(' · ')
    : '';

  return (
    <GlassPanel
      flush
      radius={22}
      ref={(el) => {
        rootRef.current = el;
        if (typeof ref === 'function') ref(el); else if (ref) ref.current = el;
      }}
      className={styles.card}
      data-apex-tooltip={`Filament sélectionné : ${selected?.name ?? '…'}. L'impression multi-couleur n'est pas encore prise en charge par Apex Studio.`}
      {...motionProps}
    >
      <CustomTooltip
        content="Filament"
        description={`Filament sélectionné : ${selected?.name ?? '…'}. L'impression multi-couleur n'est pas encore prise en charge par Apex Studio.`}
      >
        <button type="button" className={styles.current} onClick={() => {
          const r = rootRef.current?.getBoundingClientRect();
          // La carte (293 px) est plus étroite que le panneau de réglages (320 px, bord droit à 344 px) et son
          // curseur externe déborde de 4 + 12 px : la liste s'ouvre au-delà des deux, jamais par-dessus.
          if (r) { const o = zoneOrigin(); setAnchor({ left: Math.max(r.right, MENU_RIGHT_EDGE) + 24 - o.left, top: r.top - o.top }); }
          setOpen((o) => !o);
        }}>
          <span className={styles.label}>Filament</span>
          <span className={styles.name}>{selected?.name ?? (error ? 'Indisponible' : '…')}</span>
          <span className={styles.detail}>{detail}</span>
          <ChevronRight size={14} />
        </button>
      </CustomTooltip>

      <GlassPanel
        portal
        open={open}
        ref={popupRef}
        className={styles.popup}
        style={{ left: anchor.left, top: anchor.top }}
      >
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
              if (r) { const o = zoneOrigin(); setFilterAnchor({ left: r.right + 12 - o.left, top: r.top - o.top }); }
              setFilterOpen((v) => !v);
            }}
          >
            <IconFilterPlus size={16} stroke={1.75} />
          </button>
        </motion.div>
        <FilterChips filters={filters} commitFilters={commitFilters} />
        <FilamentList error={error} shown={shown} selectedKey={selectedKey} onPick={(key) => { setSelectedFilamentKey(key); setOpen(false); setQuery(''); }} />
      </GlassPanel>
      <FilamentFilterPanel
        ref={filterRef}
        open={open && filterOpen}
        style={{ left: filterAnchor.left, top: filterAnchor.top }}
        filaments={filaments}
        applied={filters}
        onApply={(f) => { commitFilters(f); setFilterOpen(false); }}
        onClose={() => setFilterOpen(false)}
      />
    </GlassPanel>
  );
});
FilamentSelector.displayName = 'FilamentSelector';
