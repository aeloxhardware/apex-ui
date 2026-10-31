import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { GlassPanel } from './GlassPanel';
import { ExternalScrollArea } from './ExternalScrollArea';
import { ApexCheckbox } from './ApexCheckbox';
import { bottomTip } from './edit-node/bottomTooltip';
import { filamentFamily, OTHER_FAMILY, type FilamentProfile } from '@/utils/filamentCatalog';
import styles from './FilamentFilterPanel.module.scss';

/** Un filtre de la liste des filaments : une marque ou un type de matériau, inclusif (ne garde que lui) ou exclusif (le retire). */
export interface FilamentFilter {
  kind: 'brand' | 'type';
  value: string;
  mode: 'include' | 'exclude';
}
export const NO_FILTERS: FilamentFilter[] = [];

/**
 * Le filament passe-t-il les filtres ? Filtres inclusifs d'une même catégorie : l'un OU l'autre ; catégories
 * différentes (marque, matériau) : ET ; un filtre exclusif qui correspond retire le filament.
 */
export function matchesFilters(f: Pick<FilamentProfile, 'vendor' | 'type'>, filters: FilamentFilter[]): boolean {
  const valueOf = (kind: FilamentFilter['kind']) => (kind === 'brand' ? f.vendor : f.type);
  if (filters.some((x) => x.mode === 'exclude' && valueOf(x.kind) === x.value)) return false;
  for (const kind of ['brand', 'type'] as const) {
    const included = filters.filter((x) => x.kind === kind && x.mode === 'include');
    if (included.length > 0 && !included.some((x) => valueOf(kind) === x.value)) return false;
  }
  return true;
}

/** Brouillon du panneau : cases cochées et mode des filtres qu'on ajoute (les filtres déjà posés gardent le leur). */
interface Draft {
  brands: string[];
  types: string[];
  mode: FilamentFilter['mode'];
}
const draftFrom = (applied: FilamentFilter[]): Draft => ({
  brands: applied.filter((x) => x.kind === 'brand').map((x) => x.value),
  types: applied.filter((x) => x.kind === 'type').map((x) => x.value),
  mode: 'include',
});
/** Liste de filtres issue du brouillon : un filtre déjà posé et toujours coché est conservé tel quel (mode compris). */
const filtersFrom = (draft: Draft, applied: FilamentFilter[]): FilamentFilter[] => {
  const make = (kind: FilamentFilter['kind'], values: string[]) => values.map((value): FilamentFilter =>
    applied.find((x) => x.kind === kind && x.value === value) ?? { kind, value, mode: draft.mode });
  return [...make('brand', draft.brands), ...make('type', draft.types)];
};

type Step = { kind: 'mode' } | { kind: 'brands' } | { kind: 'families' } | { kind: 'variants'; family: string };

const sortedCounts = (values: string[]): Array<[string, number]> => {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true, sensitivity: 'base' }));
};

const HOUSE_BRAND = 'Aelox Hardware';

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

/** Texte de bas d'écran du titre du panneau, selon l'écran affiché. */
const TITLE_TIPS: Record<Step['kind'], string> = {
  mode: 'Filtrer la liste des filaments par marque ou par matériau.',
  brands: 'Cochez les marques à inclure ou à exclure de la liste.',
  families: 'Choisissez une famille de matériaux pour en cocher les variantes.',
  variants: 'Cochez les variantes de cette famille à inclure ou à exclure de la liste.',
};

const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

/**
 * Panneau de filtre du sélecteur de filament, ouvert sur le côté de la liste : « Par marque », « Par matériau »
 * (familles, puis cases à cocher des variantes : PC → PC, PC-CF, PC-GF…), « Pour vous » (pas encore disponible).
 * Les cases sont un brouillon ; « OK » l'applique à la liste.
 */
export const FilamentFilterPanel = React.forwardRef<HTMLDivElement, {
  open: boolean;
  style: React.CSSProperties;
  filaments: FilamentProfile[];
  applied: FilamentFilter[];
  onApply: (filters: FilamentFilter[]) => void;
  /** Retour depuis l'écran principal : referme le panneau (sans appliquer le brouillon). */
  onClose: () => void;
}>(({ open, style, filaments, applied, onApply, onClose }, ref) => {
  const [step, setStep] = useState<Step>({ kind: 'mode' });
  const [draft, setDraft] = useState<Draft>(() => draftFrom(applied));

  // À chaque ouverture : retour au choix du mode, brouillon = filtres actuellement appliqués.
  useEffect(() => {
    if (open) { setStep({ kind: 'mode' }); setDraft(draftFrom(applied)); }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Aelox Hardware (éditeur d'Apex) figure toujours dans les marques, même sans profil au catalogue Orca pour l'instant.
  const brands = useMemo(() => {
    const counted = sortedCounts(filaments.map((f) => f.vendor));
    if (counted.some(([brand]) => brand === HOUSE_BRAND)) return counted;
    return [...counted, [HOUSE_BRAND, 0] as [string, number]]
      .sort((x, y) => x[0].localeCompare(y[0], undefined, { numeric: true, sensitivity: 'base' }));
  }, [filaments]);
  const families = useMemo(() => {
    const byFamily = new Map<string, string[]>();
    for (const f of filaments) {
      const family = filamentFamily(f.type);
      byFamily.set(family, [...(byFamily.get(family) ?? []), f.type ?? '—']);
    }
    // Les plus fournies d'abord, « Autres » en dernier.
    return [...byFamily]
      .map(([family, types]) => ({ family, count: types.length, variants: sortedCounts(types) }))
      .sort((a, b) => (a.family === OTHER_FAMILY ? 1 : b.family === OTHER_FAMILY ? -1 : b.count - a.count));
  }, [filaments]);

  const title = step.kind === 'mode' ? 'Filtrer'
    : step.kind === 'brands' ? 'Par marque'
    : step.kind === 'families' ? 'Par matériau'
    : step.family;
  const back = () => {
    if (step.kind === 'mode') onClose();
    else setStep(step.kind === 'variants' ? { kind: 'families' } : { kind: 'mode' });
  };

  return (
    <GlassPanel portal open={open} ref={ref} className={styles.panel} style={style} data-scroll-edge>
      <div className={styles.header}>
        <button
          type="button"
          className={styles.back}
          onClick={back}
          aria-label="Retour"
          {...bottomTip('Retour', step.kind === 'mode' ? 'Retour à la liste des filaments, sans appliquer les cases cochées.' : 'Retour au choix précédent.')}
        >
          <ChevronLeft size={14} />
        </button>
        <span className={styles.title} {...bottomTip(title, TITLE_TIPS[step.kind])}>{title}</span>
        <div className={styles.mode} role="group" aria-label="Mode du filtre">
          {(['include', 'exclude'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className={draft.mode === mode ? `${styles.modeButton} ${styles.modeActive}` : styles.modeButton}
              aria-pressed={draft.mode === mode}
              {...bottomTip(mode === 'include' ? 'Inclure' : 'Exclure', mode === 'include'
                ? 'Les prochains filtres ajoutés seront inclusifs : la liste ne montrera que les éléments cochés.'
                : 'Les prochains filtres ajoutés seront exclusifs : la liste cachera les éléments cochés.')}
              onClick={() => setDraft((d) => ({ ...d, mode }))}
            >
              {mode === 'include' ? 'Inclure' : 'Exclure'}
            </button>
          ))}
        </div>
      </div>

      {/* Curseur flottant par défaut (ExternalScrollArea), dessiné hors du panneau (data-scroll-edge). */}
      <ExternalScrollArea className={styles.scrollArea} contentClassName={styles.body}>
        {step.kind === 'mode' && (
          <>
            <button type="button" className={styles.row} onClick={() => setStep({ kind: 'brands' })} {...bottomTip('Par marque', 'Ne montrer que les filaments de certaines marques.')}>
              <span>Par marque</span><ChevronRight size={14} />
            </button>
            <button type="button" className={styles.row} onClick={() => setStep({ kind: 'families' })} {...bottomTip('Par matériau', 'Ne montrer que certains matériaux (PLA, PETG, PC et leurs variantes chargées…).')}>
              <span>Par matériau</span><ChevronRight size={14} />
            </button>
            <button type="button" className={`${styles.row} ${styles.disabled}`} aria-disabled {...bottomTip('Pour vous', "Sélection selon vos habitudes d'impression : arrive bientôt.")}>
              <span>Pour vous</span><span className={styles.meta}>Bientôt</span>
            </button>
          </>
        )}

        {step.kind === 'brands' && brands.map(([brand, count]) => (
          <label key={brand} className={styles.check} {...bottomTip(brand, `${plural(count, 'profil')} de la marque ${brand}. Cochez pour l'ajouter au filtre, décochez pour le retirer.`)}>
            <ApexCheckbox checked={draft.brands.includes(brand)} onChange={() => setDraft((d) => ({ ...d, brands: toggle(d.brands, brand) }))} />
            <span className={styles.checkLabel}>{brand}</span>
            <span className={styles.meta}>{count}</span>
          </label>
        ))}

        {step.kind === 'families' && families.map(({ family, count, variants }) => {
          const chosen = variants.filter(([type]) => draft.types.includes(type)).length;
          return (
            <button key={family} type="button" className={styles.row} onClick={() => setStep({ kind: 'variants', family })} {...bottomTip(family, `${plural(count, 'profil')} de la famille ${family}. Cliquez pour choisir ses variantes (cases à cocher).`)}>
              <span>{family}</span>
              <span className={styles.meta}>{chosen > 0 ? `${chosen} coché${chosen > 1 ? 's' : ''} · ` : ''}{count}</span>
              <ChevronRight size={14} />
            </button>
          );
        })}

        {step.kind === 'variants' && families.find((f) => f.family === step.family)?.variants.map(([type, count]) => (
          <label key={type} className={styles.check} {...bottomTip(type, `${plural(count, 'profil')} de type ${type}. Cochez pour l'ajouter au filtre, décochez pour le retirer.`)}>
            <ApexCheckbox checked={draft.types.includes(type)} onChange={() => setDraft((d) => ({ ...d, types: toggle(d.types, type) }))} />
            <span className={styles.checkLabel}>{type}</span>
            <span className={styles.meta}>{count}</span>
          </label>
        ))}
      </ExternalScrollArea>

      <button
        type="button"
        className={styles.ok}
        onClick={() => onApply(filtersFrom(draft, applied))}
        {...bottomTip('OK', 'Applique les cases cochées comme filtre de la liste des filaments.')}
      >
        OK
      </button>
    </GlassPanel>
  );
});
FilamentFilterPanel.displayName = 'FilamentFilterPanel';
