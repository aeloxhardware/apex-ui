import React, { useEffect, useState } from 'react';
import {
  EDIT_INFLUENCE_EVENT,
  EDIT_LIMITS_EVENT,
  EDIT_LOCK_MODE_EVENT,
  EDIT_REQUEST_STATE_EVENT,
  EDIT_STATE_EVENT,
  EDIT_SYMMETRY_EVENT,
  EDIT_FILE_INFO_EVENT,
  type EditFileInfo,
  type EditInfluenceSettings,
  type EditLockMode,
  type EditStateDetail,
} from './editProtocol';
import type { MachineLimits } from '@/utils/machineLimits';
import { HeadAxisValues } from './HeadAxisValues';
import styles from './EditionPanel.module.scss';
import { ExternalScrollArea } from '../ExternalScrollArea';
import { send, initialState, STATUS_TEXT } from './editionPanelData';
import {
  DeltaEdit, ExtrusionRow, InfluenceSection, LayerSection, Legend, LocksSection, SmoothRow, SymmetrySection,
  Toolbar, TrimmingSection, ValiditySection, type PanelCtx,
} from './EditionPanelSections';

/** État du noyau et infos du fichier, suivis par les événements `apex-edit-*`. */
function useEditState() {
  const [state, setState] = useState<EditStateDetail>(initialState);
  const [file, setFile] = useState<EditFileInfo>({ name: null, canSaveInPlace: false });
  useEffect(() => {
    const onState = (e: Event) => setState((e as CustomEvent<EditStateDetail>).detail);
    const onFile = (e: Event) => setFile((e as CustomEvent<EditFileInfo>).detail);
    window.addEventListener(EDIT_STATE_EVENT, onState);
    window.addEventListener(EDIT_FILE_INFO_EVENT, onFile);
    send(EDIT_REQUEST_STATE_EVENT);
    return () => {
      window.removeEventListener(EDIT_STATE_EVENT, onState);
      window.removeEventListener(EDIT_FILE_INFO_EVENT, onFile);
    };
  }, []);
  return { state, file };
}

/**
 * Onglet Édition de Prévisualisation : pose du nœud, réglages d'influence, valeurs exactes du
 * déplacement (saisissables), épaisseurs, rognage, verrous, symétrie, validation physique et
 * historique. Ne parle à la vue 3D que par les événements `apex-edit-*` (editProtocol.ts) ; le calcul
 * est fait par le noyau C++. Les sections sont dans EditionPanelSections.tsx.
 */
export const EditionPanel: React.FC = () => {
  const { state, file } = useEditState();
  const [normalsHelp, setNormalsHelp] = useState(false);
  const [manualFactor, setManualFactor] = useState(false);

  const ready = state.status === 'ready';
  const influence = state.influence;
  const extrusion = influence.extrusion ?? { mode: 'auto' as const, factor: 1 };
  const extrusionChoice = extrusion.mode === 'off' ? 'off' : manualFactor || extrusion.factor !== 1 ? 'manual' : 'auto';
  const setInfluence = (next: EditInfluenceSettings) => send(EDIT_INFLUENCE_EVENT, { influence: next });
  const setLimits = (next: MachineLimits) => send(EDIT_LIMITS_EVENT, { limits: next });
  const setLockMode = (mode: EditLockMode, radiusMm = state.lockRadiusMm) => send(EDIT_LOCK_MODE_EVENT, { mode, radiusMm });
  const setSymmetry = (patch: Partial<EditStateDetail['symmetry']>) => send(EDIT_SYMMETRY_EVENT, { symmetry: { ...state.symmetry, ...patch } });
  const ctx: PanelCtx = { state, ready, influence, setInfluence };

  return (
    <div className={styles.frame}>
      <ExternalScrollArea className={styles.scrollArea} contentClassName={styles.root}>
        <Toolbar state={state} ready={ready} file={file} />

        {!ready || state.message ? (
          <div className={styles.status}>{state.message ?? STATUS_TEXT[state.status]}</div>
        ) : null}

        <HeadAxisValues />
        <DeltaEdit state={state} ready={ready} />
        <LayerSection ctx={ctx} />
        <ExtrusionRow ctx={ctx} extrusionChoice={extrusionChoice} setManualFactor={setManualFactor} />
        <SmoothRow ctx={ctx} />
        <InfluenceSection ctx={ctx} />
        <TrimmingSection ctx={ctx} />
        <LocksSection state={state} ready={ready} setLockMode={setLockMode} />
        <SymmetrySection state={state} ready={ready} setSymmetry={setSymmetry} />
        <ValiditySection ctx={ctx} setLimits={setLimits} normalsHelp={normalsHelp} setNormalsHelp={setNormalsHelp} />
        <Legend />
      </ExternalScrollArea>
    </div>
  );
};
