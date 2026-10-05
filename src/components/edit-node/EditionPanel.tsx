import React, { useEffect, useState } from 'react';
import { Crosshair, Redo2, Trash2, Undo2 } from 'lucide-react';
import type { EditFalloff } from '@/utils/editKernelClient';
import {
  DEFAULT_EDIT_INFLUENCE,
  EDIT_INFLUENCE_EVENT,
  EDIT_PLACE_EVENT,
  EDIT_REDO_EVENT,
  EDIT_REMOVE_NODE_EVENT,
  EDIT_REQUEST_STATE_EVENT,
  EDIT_STATE_EVENT,
  EDIT_UNDO_EVENT,
  type EditInfluenceSettings,
  type EditStateDetail,
} from './editProtocol';
import styles from './EditionPanel.module.scss';

/**
 * Onglet Édition de Prévisualisation : pose du nœud, réglages d'influence, valeurs exactes du
 * déplacement et historique. Ne parle à la vue 3D que par les événements `apex-edit-*`
 * (editProtocol.ts) ; le calcul est fait par le noyau C++.
 */

const FALLOFFS: { id: EditFalloff; label: string }[] = [
  { id: 'cubic', label: 'Cubique' },
  { id: 'gaussian', label: 'Gaussienne' },
  { id: 'linear', label: 'Linéaire' },
  { id: 'plateau', label: 'Plateau' },
];

const send = (name: string, detail?: unknown) => window.dispatchEvent(new CustomEvent(name, { detail }));

const initialState: EditStateDetail = {
  status: 'inactive', message: null, placing: false, hasNode: false, busy: false,
  undoDepth: 0, redoDepth: 0, affected: 0, delta: null, influence: DEFAULT_EDIT_INFLUENCE,
};

const STATUS_TEXT: Record<EditStateDetail['status'], string> = {
  inactive: 'Aucun G-code affiché.',
  unavailable: "Disponible dans l'application de bureau.",
  unsupported: "Réservé aux G-code polaires de l'Apex.",
  loading: 'Préparation du noyau d’édition…',
  ready: '',
  error: 'Noyau d’édition indisponible.',
};

const fmt = (v: number, digits: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}`;

export const EditionPanel: React.FC = () => {
  const [state, setState] = useState<EditStateDetail>(initialState);

  useEffect(() => {
    const onState = (e: Event) => setState((e as CustomEvent<EditStateDetail>).detail);
    window.addEventListener(EDIT_STATE_EVENT, onState);
    send(EDIT_REQUEST_STATE_EVENT);
    return () => window.removeEventListener(EDIT_STATE_EVENT, onState);
  }, []);

  const ready = state.status === 'ready';
  const influence = state.influence;
  const setInfluence = (next: EditInfluenceSettings) => send(EDIT_INFLUENCE_EVENT, { influence: next });

  const metric = (
    key: 'spatial' | 'along',
    label: string,
    hint: string,
  ) => {
    const m = influence[key];
    return (
      <div className={styles.metric}>
        <label className={styles.check} title={hint}>
          <input
            type="checkbox"
            checked={m.enabled}
            disabled={!ready}
            onChange={(e) => setInfluence({ ...influence, [key]: { ...m, enabled: e.target.checked } })}
          />
          {label}
        </label>
        <input
          className={styles.number}
          type="number"
          min={0}
          step={0.1}
          value={m.radiusMm}
          disabled={!ready || !m.enabled}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (Number.isFinite(v) && v >= 0) setInfluence({ ...influence, [key]: { ...m, radiusMm: v } });
          }}
        />
        <span className={styles.unit}>mm</span>
        <select
          className={styles.select}
          value={m.falloff}
          disabled={!ready || !m.enabled}
          onChange={(e) => setInfluence({ ...influence, [key]: { ...m, falloff: e.target.value as EditFalloff } })}
        >
          {FALLOFFS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
      </div>
    );
  };

  const adj = influence.adjacency;

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <button
          type="button"
          className={`${styles.button} ${state.placing ? styles.on : ''}`}
          disabled={!ready}
          onClick={() => send(EDIT_PLACE_EVENT, { active: !state.placing })}
          title="Cliquer sur la trajectoire pour y poser un nœud"
        >
          <Crosshair size={14} /> {state.placing ? 'Cliquer sur la trajectoire…' : 'Placer un nœud'}
        </button>
        <button
          type="button"
          className={styles.icon}
          disabled={!state.hasNode}
          onClick={() => send(EDIT_REMOVE_NODE_EVENT)}
          title="Retirer le nœud (Échap)"
        >
          <Trash2 size={14} />
        </button>
        <span className={styles.spacer} />
        <button
          type="button"
          className={styles.icon}
          disabled={!ready || state.undoDepth === 0}
          onClick={() => send(EDIT_UNDO_EVENT)}
          title={`Annuler (Ctrl+Z) — ${state.undoDepth}`}
        >
          <Undo2 size={14} />
        </button>
        <button
          type="button"
          className={styles.icon}
          disabled={!ready || state.redoDepth === 0}
          onClick={() => send(EDIT_REDO_EVENT)}
          title={`Rétablir (Ctrl+Y) — ${state.redoDepth}`}
        >
          <Redo2 size={14} />
        </button>
      </div>

      {!ready || state.message ? (
        <div className={styles.status}>{state.message ?? STATUS_TEXT[state.status]}</div>
      ) : null}

      <div className={styles.delta}>
        {([
          ['ΔR', state.delta?.r, 3, 'mm'],
          ['ΔC', state.delta?.c, 2, '°'],
          ['ΔZ', state.delta?.z, 3, 'mm'],
          ['ΔB', state.delta?.b, 2, '°'],
        ] as const).map(([name, v, digits, unit]) => (
          <div key={name} className={styles.field}>
            <span className={styles.fieldName}>{name}</span>
            <span className={styles.fieldValue}>{v === undefined ? '—' : fmt(v, digits)}</span>
            <span className={styles.unit}>{unit}</span>
          </div>
        ))}
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>
          Influence
          <span className={styles.count}>{state.hasNode ? `${state.affected.toLocaleString('fr-FR')} points` : ''}</span>
        </div>
        {metric('spatial', 'Distance 3D', 'Portée minimale dans toutes les directions ; chaque poignée l’allonge dans son sens (sa longueur).')}
        {metric('along', 'Le long du cordon', 'Distance parcourue le long des cordons, passage d’un cordon à l’autre compté par son seul décalage latéral.')}
        <div className={styles.metric}>
          <label className={styles.check} title="Nombre de trajectoires adjacentes franchies : celles déposées avant (supports) et après (posées dessus).">
            <input
              type="checkbox"
              checked={adj.enabled}
              disabled={!ready}
              onChange={(e) => setInfluence({ ...influence, adjacency: { ...adj, enabled: e.target.checked } })}
            />
            Trajectoires adjacentes
          </label>
          <input
            className={styles.number}
            type="number"
            min={0}
            step={1}
            value={adj.hopsBefore}
            disabled={!ready || !adj.enabled}
            title="Avant (supports)"
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (v >= 0) setInfluence({ ...influence, adjacency: { ...adj, hopsBefore: v } });
            }}
          />
          <input
            className={styles.number}
            type="number"
            min={0}
            step={1}
            value={adj.hopsAfter}
            disabled={!ready || !adj.enabled}
            title="Après (posées dessus)"
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (v >= 0) setInfluence({ ...influence, adjacency: { ...adj, hopsAfter: v } });
            }}
          />
          <select
            className={styles.select}
            value={adj.falloff}
            disabled={!ready || !adj.enabled}
            onChange={(e) => setInfluence({ ...influence, adjacency: { ...adj, falloff: e.target.value as EditFalloff } })}
          >
            {FALLOFFS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
        </div>
        <div className={styles.metric}>
          <span className={styles.check}>Combinaison</span>
          <select
            className={styles.select}
            value={influence.combine}
            disabled={!ready}
            onChange={(e) => setInfluence({ ...influence, combine: e.target.value as 'product' | 'max' })}
            title="Produit : les critères se restreignent. Maximum : ils s’étendent."
          >
            <option value="product">Produit (intersection)</option>
            <option value="max">Maximum (union)</option>
          </select>
        </div>
      </div>

      <div className={styles.legend}>
        <span className={styles.ramp} />
        <span>Poids de l’influence, 0 → 1</span>
      </div>
      <div className={styles.help}>
        Glisser le nœud déforme la trajectoire. Poignées : longueur = portée, orientation = sens
        préféré ; clic = ancrage (orange) ; glisser dans le nœud = supprimer ; « + » = ajouter.
      </div>
    </div>
  );
};
