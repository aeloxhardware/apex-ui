// Issu de la découpe de createGCodeEditController (gcodeEditController.ts) : le texte des instructions est conservé ;
// les variables partagées entre morceaux passent par `st` (controllerState.ts).
import { editKernel } from '@/utils/editKernelClient';
import { fingerprintOf } from '@/utils/apexHeader';
import { currentValues, groupsOf, journalEntryOf, toHistory, type JournalCommit } from '../editJournal';
import { type ParsedGCode } from '../../gcodeParse';
import type { EditControllerState } from './controllerState';

function setupRestoreJournal(st: EditControllerState) {
  // --- journal (D5) : historique écrit dans l'en-tête chiffré, relu à la réouverture ---------------

  /** Historique relu dans l'en-tête du fichier : rendu au noyau si le fichier n'a pas changé
   * depuis (empreinte de la dernière modification) ; sinon ignoré, avec un message. */
  const restoreJournal = async (parsed: ParsedGCode) => {
    const journal = parsed.apexHeader?.journal;
    if (!journal || (journal.undo.length === 0 && journal.redo.length === 0)) return;
    const last = journal.undo[journal.undo.length - 1];
    if (last) {
      const now = await fingerprintOf(last.indices, currentValues(parsed, last.indices));
      if (now !== last.fingerprint) {
        st.message = "Historique du fichier ignoré : le fichier a été modifié hors d'Apex depuis.";
        return;
      }
    }
    try {
      const depths = await editKernel.restoreHistory({ undo: journal.undo.map(toHistory), redo: journal.redo.map(toHistory) });
      st.undoDepth = depths.undoDepth;
      st.redoDepth = depths.redoDepth;
      st.undoGroups = groupsOf(journal.undo);
      st.redoGroups = groupsOf(journal.redo);
      parsed.editJournal = { undo: [...journal.undo], redo: [...journal.redo] };
    } catch (error) {
      st.message = `Historique du fichier ignoré : ${error instanceof Error ? error.message : String(error)}`;
    }
  };
    st.restoreJournal = restoreJournal;

  /** Nouvelle entrée du journal pour une validation (avant / après, transformation, influence). */
  const journalCommit = async (parsed: ParsedGCode, commit: JournalCommit) => {
    if (parsed.insertedBlocks?.length) return;
    const journal = (parsed.editJournal ??= { undo: [], redo: [] });
    const entry = journalEntryOf(commit);
    journal.undo.push(entry);
    journal.redo = [];
    entry.fingerprint = await fingerprintOf(commit.indices, commit.after);
  };

  const journalStep = (parsed: ParsedGCode, step: 'undo' | 'redo') => {
    const journal = parsed.editJournal;
    if (!journal) return;
    const from = step === 'undo' ? journal.undo : journal.redo;
    const to = step === 'undo' ? journal.redo : journal.undo;
    const entry = from.pop();
    if (entry) to.push(entry);
  };
  Object.assign(st, { journalCommit, journalStep });
}

export function setupEditControllerJournal(st: EditControllerState) {
  setupRestoreJournal(st);
}
