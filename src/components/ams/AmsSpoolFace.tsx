import React from 'react';
import { AmsSpool } from './AmsSpool';
import type { AmsEntry } from './amsSpoolsState';
import type { FilamentProfile } from '@/utils/filamentCatalog';
import styles from './AmsBox.module.scss';

/** Une bobine de l'AMS avec son profil (pour la copie floutée du « + »). */
export interface GhostSpool {
  entry: AmsEntry;
  profile: FilamentProfile | undefined;
}

/** Texte noir sur un filament clair, blanc sur un filament sombre (luminance relative approchée). */
function labelColor(hex: string): string {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#14171c' : '#fff';
}

/** La bobine dessinée (joues, filament, aspect) et, posé dessus à la verticale, le matériau de son profil. */
export const AmsSpoolFace: React.FC<GhostSpool> = ({ entry, profile }) => (
  <>
    <AmsSpool color={entry.color} finish={profile?.finish ?? null} edited={profile?.user === true} />
    <span className={styles.material} style={{ color: labelColor(entry.color) }}>
      {profile?.type ?? ''}
    </span>
  </>
);
