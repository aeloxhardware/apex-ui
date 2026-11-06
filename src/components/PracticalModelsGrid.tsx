import React, { useEffect, useState } from 'react';
import { ExternalScrollArea } from './ExternalScrollArea';
import { parseStl, renderStlThumbnail } from '@/utils/stlThumbnail';

/**
 * Contenu du sous-menu « Ajouter des modèles pratiques » : un bouton carré par modèle de test, avec son rendu gris,
 * triés par nom. Les modèles sont les `.stl` de `src/assets/practical-models/` (ajouter un fichier dans ce dossier
 * suffit). Les miniatures sont dessinées une à une à l'ouverture, puis gardées en mémoire.
 */
const urls = import.meta.glob('@/assets/practical-models/*.stl', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

export interface PracticalModel {
  fileName: string;
  label: string;
  url: string;
}

const PRACTICAL_MODELS: PracticalModel[] = Object.entries(urls)
  .map(([path, url]) => {
    const fileName = path.slice(path.lastIndexOf('/') + 1);
    return { fileName, label: fileName.replace(/\.stl$/i, '').replace(/[_-]+/g, ' '), url };
  })
  .sort((a, b) => a.fileName.localeCompare(b.fileName, 'fr', { numeric: true, sensitivity: 'base' }));

const THUMB_PX = 160; // dessin à 160 px pour un bouton de 80 px : net sur écran dense
const BUTTON_PX = 80;
const TILE_GAP = 6;
const COLUMNS = 3;
const MAX_ROWS = 4;
/**
 * Cascade : une carte à la fois, dans l'ordre. Elle apparaît dès que sa miniature est prête, mais jamais moins de
 * `GAP_MS` après la précédente ; quand des miniatures attendent déjà, l'écart se réduit (GAP_MS / (1 + en attente),
 * plancher `MIN_GAP_MS`) pour rattraper le retard. Rendu lent : les cartes suivent le rythme du rendu.
 */
const GAP_MS = 70;
const MIN_GAP_MS = 18;
const APPEAR_MS = 280;

const triangleCache = new Map<string, Promise<Float32Array>>();
const loadTriangles = (model: PracticalModel) => {
  let cached = triangleCache.get(model.url);
  if (!cached) {
    cached = fetch(model.url).then((r) => r.arrayBuffer()).then(parseStl);
    triangleCache.set(model.url, cached);
  }
  return cached;
};

// Les miniatures se dessinent l'une après l'autre, avec une pause entre deux pour laisser respirer l'interface ;
// une fois dessinée, l'image est gardée (ouvrir le menu une deuxième fois est instantané).
const thumbnailCache = new Map<string, Promise<string>>();
let renderQueue: Promise<unknown> = Promise.resolve();
const getThumbnail = (model: PracticalModel): Promise<string> => {
  let cached = thumbnailCache.get(model.url);
  if (!cached) {
    cached = new Promise<string>((resolve, reject) => {
      renderQueue = renderQueue
        .then(() => loadTriangles(model))
        .then(async (tris) => {
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = THUMB_PX;
          renderStlThumbnail(tris, canvas);
          resolve(canvas.toDataURL('image/png'));
          await new Promise((r) => setTimeout(r, 0));
        })
        .catch((err) => { thumbnailCache.delete(model.url); reject(err); });
    });
    thumbnailCache.set(model.url, cached);
  }
  return cached;
};

/** Lance le dessin des miniatures sans attendre l'ouverture du sous-menu (appelé à l'ouverture du menu contextuel). */
export const prewarmPracticalModels = () => {
  for (const model of PRACTICAL_MODELS) void getThumbnail(model).catch((): void => undefined);
};

/** Récupère le fichier du modèle pour l'importer comme un fichier choisi par l'utilisateur, sous le nom donné. */
export const fetchPracticalModelFile = async (model: PracticalModel, name: string) =>
  new File([await (await fetch(model.url)).arrayBuffer()], name, { type: 'model/stl' });

/** Carte d'un modèle : invisible tant que la cascade ne l'a pas révélée, puis fondu + glissement. */
const Tile: React.FC<{ model: PracticalModel; revealed: boolean; onPick: () => void; onHover: (over: boolean) => void }> = ({ model, revealed, onPick, onHover }) => {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    getThumbnail(model)
      .then((url) => { if (!cancelled) setSrc(url); })
      .catch((err) => console.error(`Miniature de ${model.fileName} impossible :`, err));
    return () => { cancelled = true; };
  }, [model]);
  const shown = revealed && src !== null;
  return (
    <button
      type="button"
      aria-label={model.label}
      onClick={onPick}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onPointerEnter={(e) => { e.currentTarget.style.background = 'rgba(0,240,255,0.18)'; }}
      onPointerLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; }}
      style={{
        width: BUTTON_PX, height: BUTTON_PX, padding: 4, border: 'none', borderRadius: 10, cursor: 'pointer',
        background: 'rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        opacity: shown ? 1 : 0, transform: shown ? 'translateY(0)' : 'translateY(10px)',
        pointerEvents: shown ? 'auto' : 'none',
        transition: `opacity ${APPEAR_MS}ms cubic-bezier(0.16, 1, 0.3, 1), transform ${APPEAR_MS}ms cubic-bezier(0.16, 1, 0.3, 1), background 0.15s ease`,
      }}
    >
      {src && <img src={src} alt="" draggable={false} style={{ width: BUTTON_PX - 8, height: BUTTON_PX - 8, pointerEvents: 'none' }} />}
    </button>
  );
};

/** Nombre de cartes révélées, à faire avancer au rythme du rendu des miniatures (cf. GAP_MS). */
function useCascade(count: number): number {
  const [revealed, setRevealed] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const ready = new Array<boolean>(count).fill(false);
    PRACTICAL_MODELS.forEach((model, i) => {
      // Une miniature en échec compte comme prête : la cascade continue sans elle.
      getThumbnail(model).catch((): void => undefined).then(() => { ready[i] = true; });
    });
    let next = 0;
    let last = performance.now() - GAP_MS;
    const step = () => {
      if (cancelled || next >= count) return;
      if (!ready[next]) { timer = window.setTimeout(step, 8); return; }
      let waiting = 0;
      for (let i = next + 1; i < count; i++) if (ready[i]) waiting++;
      const gap = Math.max(MIN_GAP_MS, GAP_MS / (1 + waiting));
      timer = window.setTimeout(() => {
        if (cancelled) return;
        next++;
        last = performance.now();
        setRevealed(next);
        step();
      }, Math.max(0, last + gap - performance.now()));
    };
    step();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [count]);
  return revealed;
}

interface PracticalModelsGridProps {
  onPick: (model: PracticalModel) => void;
  onHover: (model: PracticalModel | null) => void;
}

export const PracticalModelsGrid: React.FC<PracticalModelsGridProps> = ({ onPick, onHover }) => {
  const revealed = useCascade(PRACTICAL_MODELS.length);
  // Au plus 3 colonnes × 4 rangées visibles ; au-delà, la grille défile avec le curseur externe (ExternalScrollArea).
  const rows = Math.min(MAX_ROWS, Math.max(1, Math.ceil(PRACTICAL_MODELS.length / COLUMNS)));
  return (
    <div style={{ width: COLUMNS * BUTTON_PX + (COLUMNS - 1) * TILE_GAP, height: rows * BUTTON_PX + (rows - 1) * TILE_GAP, display: 'flex', flexDirection: 'column' }}>
      <ExternalScrollArea>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${COLUMNS}, ${BUTTON_PX}px)`, gap: TILE_GAP }}>
          {PRACTICAL_MODELS.length === 0 && (
            <div style={{ gridColumn: '1 / -1', padding: '8px 10px', fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>Aucun modèle</div>
          )}
          {PRACTICAL_MODELS.map((model, index) => (
            <Tile key={model.fileName} model={model} revealed={index < revealed} onPick={() => onPick(model)} onHover={(over) => onHover(over ? model : null)} />
          ))}
        </div>
      </ExternalScrollArea>
    </div>
  );
};
