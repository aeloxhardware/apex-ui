import React from 'react';
import { X, User } from 'lucide-react';
import { AmsBackdrop } from './AmsBackdrop';
import { AmsSpool } from './AmsSpool';
import type { AmsEntry } from './amsSpoolsState';
import { bottomTip } from '@/components/edit-node/bottomTooltip';
import { CLOSE_TIP, spoolTip } from '@/utils/amsTooltips';
import { brandOf, materialNameOf, profileFacts } from '@/utils/filamentText';
import type { FilamentProfile } from '@/utils/filamentCatalog';
import styles from './AmsOverlays.module.scss';

/** Fiche détaillée d'une bobine : sa bobine, son nom, sa marque et les faits principaux de son profil. */
const FilamentCard: React.FC<{ entry: AmsEntry; index: number; profile: FilamentProfile; onOpen: () => void }> = ({
  entry,
  index,
  profile,
  onOpen,
}) => {
  const edited = profile.user === true;
  return (
    <button type="button" className={styles.card} onClick={onOpen} {...bottomTip(materialNameOf(profile), spoolTip(profile))}>
      <div className={styles.cardSpool}>
        <AmsSpool color={entry.color} finish={profile.finish} edited={edited} />
      </div>
      <div className={styles.cardBody}>
        <div className={styles.cardHead}>
          <span className={styles.cardIndex}>{index + 1}</span>
          <span className={styles.cardName}>{materialNameOf(profile)}</span>
          {edited && <User size={13} className={styles.cardUser} />}
        </div>
        <div className={styles.cardBrand}>
          {brandOf(profile)}
          {edited ? " · modifié par l'utilisateur" : ''}
        </div>
        <dl className={styles.facts}>
          {profileFacts(profile).map(([label, value]) => (
            <React.Fragment key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </React.Fragment>
          ))}
        </dl>
      </div>
    </button>
  );
};

/** Tous les filaments de l'AMS, chacun avec sa fiche : l'interface est floutée derrière. Clic sur une fiche : profil complet. */
export const AmsLibraryOverlay: React.FC<{
  entries: AmsEntry[];
  profiles: ReadonlyMap<string, FilamentProfile>;
  active: boolean;
  onOpenSheet: (id: string) => void;
  onClose: () => void;
}> = ({ entries, profiles, active, onOpenSheet, onClose }) => (
  <AmsBackdrop onClose={onClose} active={active}>
    <div className={styles.library}>
      <div className={styles.libraryHead}>
        <h2>
          Filaments sélectionnés <span>{entries.length}</span>
        </h2>
        <button type="button" className={styles.iconButton} aria-label="Fermer" onClick={onClose} {...bottomTip('Fermer', CLOSE_TIP)}>
          <X size={16} />
        </button>
      </div>
      <div className={styles.cards}>
        {entries.map((entry, i) => {
          const profile = profiles.get(entry.key);
          return profile ? (
            <FilamentCard key={entry.id} entry={entry} index={i} profile={profile} onOpen={() => onOpenSheet(entry.id)} />
          ) : null;
        })}
      </div>
    </div>
  </AmsBackdrop>
);
