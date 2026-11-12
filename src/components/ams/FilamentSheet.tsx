import React, { useState } from 'react';
import { Pencil, RotateCcw, User, X } from 'lucide-react';
import { AmsBackdrop } from './AmsBackdrop';
import { AmsSpool } from './AmsSpool';
import { FINISH_CHOICES, NUM_FIELDS, draftOf, isDirty } from './filamentSheetData';
import { ApexNumberField } from '@/components/ApexNumberField';
import { bottomTip } from '@/components/edit-node/bottomTooltip';
import { CLOSE_TIP, SHEET_CANCEL_TIP, SHEET_EDIT_TIP, SHEET_REVERT_TIP, SHEET_SAVE_TIP, spoolTip } from '@/utils/amsTooltips';
import { brandOf, finishLabel, materialNameOf, rangeText, withUnit } from '@/utils/filamentText';
import type { FilamentProfile } from '@/utils/filamentCatalog';
import type { FilamentEdits } from '@/utils/userFilaments';
import styles from './AmsOverlays.module.scss';

interface SheetProps {
  profile: FilamentProfile;
  /** Couleur de la bobine dans l'AMS. */
  color: string;
  /** Profil d'usine dont celui-ci est une copie (pour y revenir), s'il existe. */
  factory: FilamentProfile | undefined;
  onSave: (edits: FilamentEdits) => void;
  onRevert: () => void;
  onClose: () => void;
}

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <>
    <dt>{label}</dt>
    <dd>{children}</dd>
  </>
);

/** Lecture seule : tous les champs du profil. */
const SheetView: React.FC<{ profile: FilamentProfile }> = ({ profile }) => (
  <dl className={styles.sheetRows}>
    <Row label="Type">{profile.type ?? '—'}</Row>
    <Row label="Aspect">{finishLabel(profile.finish)}</Row>
    {NUM_FIELDS.map((f) => (
      <Row key={f.key} label={f.label}>
        {withUnit(profile[f.key], f.unit)}
      </Row>
    ))}
    <Row label="Plage de buse">{rangeText(profile.nozzle_temp_range)}</Row>
    <Row label="Fabricant du profil">{profile.vendor}</Row>
    <Row label="Source">{profile.user ? 'Profil utilisateur (copie)' : profile.orca_source}</Row>
  </dl>
);

/** Édition : le brouillon part du profil ; l'enregistrement crée une copie (cf. userFilaments.ts). */
const SheetEdit: React.FC<{ draft: FilamentEdits; setDraft: (d: FilamentEdits) => void }> = ({ draft, setDraft }) => {
  const range = draft.nozzle_temp_range ?? [null, null];
  return (
    <dl className={styles.sheetRows}>
      <Row label="Type">
        <input
          className={styles.textInput}
          value={draft.type ?? ''}
          onChange={(e) => setDraft({ ...draft, type: e.target.value || null })}
        />
      </Row>
      <Row label="Aspect">
        <div className={styles.finishChoices}>
          {FINISH_CHOICES.map((f) => (
            <button
              key={f ?? 'none'}
              type="button"
              className={draft.finish === f ? styles.choiceActive : styles.choice}
              onClick={() => setDraft({ ...draft, finish: f })}
            >
              {finishLabel(f)}
            </button>
          ))}
        </div>
      </Row>
      {NUM_FIELDS.map((f) => (
        <Row key={f.key} label={f.label}>
          <ApexNumberField
            value={draft[f.key] ?? null}
            nullable
            min={f.min}
            step={f.step}
            suffix={f.unit}
            ariaLabel={f.label}
            onChange={(v) => setDraft({ ...draft, [f.key]: v })}
          />
        </Row>
      ))}
      <Row label="Plage de buse">
        <span className={styles.rangeFields}>
          <ApexNumberField
            value={range[0]}
            nullable
            min={0}
            suffix="°C"
            ariaLabel="Buse minimale"
            onChange={(v) => setDraft({ ...draft, nozzle_temp_range: [v, range[1]] })}
          />
          <ApexNumberField
            value={range[1]}
            nullable
            min={0}
            suffix="°C"
            ariaLabel="Buse maximale"
            onChange={(v) => setDraft({ ...draft, nozzle_temp_range: [range[0], v] })}
          />
        </span>
      </Row>
    </dl>
  );
};

/** En-tête : bobine, nom, marque, crayon d'édition (hors édition) et fermeture. */
const SheetHead: React.FC<{
  profile: FilamentProfile;
  color: string;
  finish: FilamentProfile['finish'];
  editing: boolean;
  onEdit: () => void;
  onClose: () => void;
}> = ({ profile, color, finish, editing, onEdit, onClose }) => {
  const edited = profile.user === true;
  return (
    <div className={styles.sheetHead}>
      <div className={styles.sheetSpool}>
        <AmsSpool color={color} finish={finish} edited={edited} />
      </div>
      <div className={styles.sheetTitle}>
        <h2>{materialNameOf(profile)}</h2>
        <div className={styles.cardBrand}>
          {brandOf(profile)}
          {edited && (
            <span className={styles.userBadge}>
              <User size={12} /> Modifié par l'utilisateur
            </span>
          )}
        </div>
      </div>
      {!editing && (
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Éditer le profil"
          onClick={onEdit}
          {...bottomTip('Éditer', SHEET_EDIT_TIP)}
        >
          <Pencil size={16} />
        </button>
      )}
      <button type="button" className={styles.iconButton} aria-label="Fermer" onClick={onClose} {...bottomTip('Fermer', CLOSE_TIP)}>
        <X size={16} />
      </button>
    </div>
  );
};

/** Pied : « revenir au profil d'usine » (profil modifié, hors édition) ou annuler / enregistrer une copie (édition). */
const SheetFoot: React.FC<{
  editing: boolean;
  canRevert: boolean;
  dirty: boolean;
  onRevert: () => void;
  onCancel: () => void;
  onSave: () => void;
}> = ({ editing, canRevert, dirty, onRevert, onCancel, onSave }) => (
  <div className={styles.sheetFoot}>
    {!editing && canRevert && (
      <button type="button" className={styles.textButton} onClick={onRevert} {...bottomTip("Profil d'usine", SHEET_REVERT_TIP)}>
        <RotateCcw size={14} /> Revenir au profil d'usine
      </button>
    )}
    {editing && (
      <>
        <span className={styles.footNote}>Le profil d'origine n'est jamais modifié : l'enregistrement crée une copie.</span>
        <button type="button" className={styles.textButton} onClick={onCancel} {...bottomTip('Annuler', SHEET_CANCEL_TIP)}>
          Annuler
        </button>
        <button
          type="button"
          className={styles.primaryButton}
          disabled={!dirty}
          onClick={onSave}
          {...bottomTip('Enregistrer', SHEET_SAVE_TIP)}
        >
          Enregistrer une copie
        </button>
      </>
    )}
  </div>
);

/**
 * Fiche technique complète d'un filament. Le crayon passe en édition ; l'enregistrement ne touche JAMAIS le profil
 * d'origine (usine ou utilisateur) : il crée « [profil] - Copie (n) » et la bobine passe dessus. Pour un profil modifié,
 * « revenir au profil d'usine » reprend le profil d'origine et conserve la copie.
 */
export const FilamentSheet: React.FC<SheetProps> = ({ profile, color, factory, onSave, onRevert, onClose }) => {
  const [draft, setDraft] = useState<FilamentEdits | null>(null);
  return (
    <AmsBackdrop onClose={onClose} level={2}>
      <div className={styles.sheet} {...bottomTip(materialNameOf(profile), spoolTip(profile))}>
        <SheetHead
          profile={profile}
          color={color}
          finish={draft?.finish ?? profile.finish}
          editing={draft !== null}
          onEdit={() => setDraft(draftOf(profile))}
          onClose={onClose}
        />
        {draft === null ? <SheetView profile={profile} /> : <SheetEdit draft={draft} setDraft={setDraft} />}
        <SheetFoot
          editing={draft !== null}
          canRevert={profile.user === true && factory !== undefined}
          dirty={draft !== null && isDirty(draft, profile)}
          onRevert={onRevert}
          onCancel={() => setDraft(null)}
          onSave={() => {
            if (draft) onSave(draft);
            setDraft(null);
          }}
        />
      </div>
    </AmsBackdrop>
  );
};
