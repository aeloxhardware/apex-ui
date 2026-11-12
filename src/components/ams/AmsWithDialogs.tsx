import React, { useCallback, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { usePortalRoot } from '@/components/GpuWarningFrame';
import { FilamentPickerMenu } from '@/components/FilamentPickerMenu';
import { filamentKey } from '@/utils/filamentCatalog';
import { saveUserFilament, type FilamentEdits } from '@/utils/userFilaments';
import { AmsBox } from './AmsBox';
import { AmsLibraryOverlay } from './AmsLibraryOverlay';
import { FilamentSheet } from './FilamentSheet';
import { useFilamentIndex } from './amsSamples';
import { updateAmsEntries, useAmsEntries } from './amsStore';
import { entryFor, insertEntry, reorderByIds, replaceKey } from './amsSpoolsState';

/** Position du menu de choix d'un filament : à droite du « + » cliqué, dans le repère de la zone de l'interface. */
function pickerAnchor(button: HTMLElement, zone: HTMLElement) {
  const r = button.getBoundingClientRect();
  const o = zone === document.body ? { left: 0, top: 0 } : zone.getBoundingClientRect();
  return { left: r.right + 14 - o.left, top: Math.max(16, Math.min(r.top - o.top, window.innerHeight - 470)) };
}

/**
 * L'AMS et tout ce qu'il ouvre, branché sur le contenu partagé (`amsStore.ts`) : la partie basse ouvre tous les filaments,
 * une bobine ou une fiche ouvre le profil complet (édition par copie), le « + » ouvre le menu de filament de Préparation.
 */
export const AmsWithDialogs: React.FC = () => {
  const zone = usePortalRoot();
  const profiles = useFilamentIndex();
  const entries = useAmsEntries();
  const [library, setLibrary] = useState(false);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ at: number; left: number; top: number } | null>(null);
  const closePicker = useCallback(() => setPicker(null), []);

  const sheetEntry = entries.find((e) => e.id === sheetId);
  const sheetProfile = sheetEntry ? profiles.get(sheetEntry.key) : undefined;

  const saveCopy = (edits: FilamentEdits) => {
    if (!sheetEntry || !sheetProfile) return;
    const saved = saveUserFilament(sheetProfile, edits);
    updateAmsEntries((list) => replaceKey(list, sheetEntry.id, filamentKey(saved)));
  };
  const revert = () => {
    if (!sheetEntry || !sheetProfile?.baseKey) return;
    const baseKey = sheetProfile.baseKey;
    updateAmsEntries((list) => replaceKey(list, sheetEntry.id, baseKey));
  };
  const addFromLibrary = (key: string) => {
    if (!picker) return;
    const color = profiles.get(key)?.color ?? null;
    updateAmsEntries((list) => insertEntry(list, picker.at, entryFor(key, color, picker.at)));
    setPicker(null);
  };

  return (
    <>
      <AmsBox
        entries={entries}
        profiles={profiles}
        onReorder={(ids) => updateAmsEntries((list) => reorderByIds(list, ids))}
        onOpenSheet={setSheetId}
        onOpenAll={() => setLibrary(true)}
        onAdd={(at, anchor) => setPicker({ at, ...pickerAnchor(anchor, zone) })}
      />
      <FilamentPickerMenu
        open={picker !== null}
        anchor={picker ?? { left: 0, top: 0 }}
        includeUser
        onPick={addFromLibrary}
        onClose={closePicker}
      />
      <AnimatePresence>
        {library && (
          <AmsLibraryOverlay
            entries={entries}
            profiles={profiles}
            active={sheetId === null}
            onOpenSheet={setSheetId}
            onClose={() => setLibrary(false)}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {sheetEntry && sheetProfile && (
          <FilamentSheet
            key={sheetEntry.id}
            profile={sheetProfile}
            color={sheetEntry.color}
            factory={sheetProfile.baseKey ? profiles.get(sheetProfile.baseKey) : undefined}
            onSave={saveCopy}
            onRevert={revert}
            onClose={() => setSheetId(null)}
          />
        )}
      </AnimatePresence>
    </>
  );
};
