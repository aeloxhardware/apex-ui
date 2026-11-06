import { ApexSlider } from '@/components/ApexSlider';
import React from 'react';
import { importModelsOneByOne } from '@/utils/importModels';
import { EditionPanel } from '@/components/edit-node/EditionPanel';
import { setPreviewTab } from '@/components/PreviewUpperTabs';
import { formatGeneratorLabel } from '@/components/gcodeGenerator';
import { COLOR_BY_LABELS } from '@/components/gcodeColormap';
import { LINE_TYPES } from '@/components/gcodeLineTypes';
import type { ColorByMode } from '@/components/gcodeParse';
import { GCODE_ACCEPT, GCODE_SPEED_OPTIONS, type useGCodePreview } from '@/hooks/use-gcode-preview';
import styles from './ClassicApp.module.scss';

/** Sous-composants de ClassicApp (panneaux latéraux de Préparation et de Prévisualisation). */

export type GCodePreview = ReturnType<typeof useGCodePreview>;
type GCodeInfo = NonNullable<GCodePreview['fileInfo']>;

export type ModelInfo = { name: string; dimensions?: { x: number; y: number; z: number } | undefined } | null;

const TOOLS = [
  { id: 'select', label: 'Sélection' },
  { id: 'move', label: 'Déplacement' },
  { id: 'rotate', label: 'Rotation' },
  { id: 'scale', label: 'Échelle' },
];

export const VIEWS = [
  { id: 'top', label: 'Dessus' },
  { id: 'front', label: 'Face' },
  { id: 'right', label: 'Droite' },
  { id: 'left', label: 'Gauche' },
  { id: 'back', label: 'Arrière' },
  { id: 'bottom', label: 'Dessous' },
];

export const emit = (name: string, detail?: unknown) => window.dispatchEvent(new CustomEvent(name, { detail }));
const fmtTime = (s: number) => `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')} min ${String(Math.round(s % 60)).padStart(2, '0')} s`;
const num = (v: number | undefined, digits = 2) => (v === undefined || !Number.isFinite(v) ? '-' : v.toFixed(digits));

export const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className={styles.section}>
    <h3>{title}</h3>
    {children}
  </section>
);

export const Check: React.FC<{ checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }> = ({ checked, onChange, children }) => (
  <label className={styles.check}>
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    <span>{children}</span>
  </label>
);

export const PrepPanel: React.FC<{ model: ModelInfo; tool: string; setTool: (t: string) => void; importRef: React.RefObject<HTMLInputElement | null> }> = ({ model, tool, setTool, importRef }) => (
  <>
    <Section title="Modèle">
      <button type="button" onClick={() => importRef.current?.click()}>Importer un modèle (STL, GLB)…</button>
      <input
        ref={importRef}
        type="file"
        accept=".stl,.glb,.gltf"
        multiple
        hidden
        onChange={(e) => { if (e.target.files?.length) void importModelsOneByOne(Array.from(e.target.files)); e.target.value = ''; }}
      />
      <div className={styles.row}>
        <button type="button" onClick={() => emit('apex-select-all-models')}>Tout sélectionner</button>
        <button type="button" onClick={() => emit('apex-arrange-models')}>Disposer automatiquement</button>
        <button type="button" onClick={() => emit('apex-delete-all-models')}>Tout supprimer</button>
      </div>
      <table>
        <tbody>
          <tr><th>Nom</th><td>{model?.name ?? 'Aucun modèle sur le plateau'}</td></tr>
          {model?.dimensions && (
            <tr><th>Dimensions</th><td>{num(model.dimensions.x, 1)} × {num(model.dimensions.z, 1)} × {num(model.dimensions.y, 1)} mm</td></tr>
          )}
        </tbody>
      </table>
    </Section>
    <Section title="Outils">
      <div className={styles.row}>
        {TOOLS.map((t) => (
          <button key={t.id} type="button" className={tool === t.id ? styles.active : ''} onClick={() => { setTool(t.id); emit('apex-tool-changed', { tool: t.id }); }}>{t.label}</button>
        ))}
      </div>
    </Section>
  </>
);

const FileSection: React.FC<{ gp: GCodePreview }> = ({ gp }) => {
  const info = gp.fileInfo;
  const generatorRow = formatGeneratorLabel(info?.generator ?? null, 'classic');
  return (
    <Section title="Fichier G-code">
      <button type="button" onClick={gp.openFilePicker} disabled={gp.isLoading}>{gp.isLoading ? 'Chargement…' : 'Ouvrir un G-code…'}</button>
      {!info && <p className={styles.note}>Aucun G-code chargé : ouvrez-en un, ou déposez-le sur la fenêtre ({GCODE_ACCEPT}).</p>}
      {info && (
        <table>
          <tbody>
            <tr><th>Nom</th><td>{info.name}</td></tr>
            <tr><th>Type</th><td>{info.kind === 'polar' ? 'Polaire (4 axes)' : 'Cartésien (3 axes)'}</td></tr>
            <tr><th>{generatorRow.label}</th><td>{generatorRow.value}</td></tr>
            <tr><th>Imprimante</th><td>{info.printer ?? '-'}</td></tr>
            <tr><th>Mouvements</th><td>{info.moves} (dont {info.extruding} en extrusion)</td></tr>
            <tr><th>Durée</th><td>{fmtTime(info.totalTime)}</td></tr>
            <tr><th>Z</th><td>{num(info.minZ)} à {num(info.maxZ)} mm</td></tr>
            <tr><th>C</th><td>{num(info.minC, 1)} à {num(info.maxC, 1)}°</td></tr>
          </tbody>
        </table>
      )}
    </Section>
  );
};

const PlaybackSection: React.FC<{ gp: GCodePreview }> = ({ gp }) => {
  const cur = gp.current;
  return (
    <Section title="Lecture">
      <div className={styles.row}>
        <button type="button" onClick={gp.togglePlay}>{gp.isPlaying ? 'Pause' : 'Lecture'}</button>
        <select value={gp.speed} onChange={(e) => gp.setSpeed(Number(e.target.value))}>
          {GCODE_SPEED_OPTIONS.map((s) => <option key={s} value={s}>{s}×</option>)}
        </select>
      </div>
      <ApexSlider
        className={styles.wide}
        min={0}
        max={Math.max(1, gp.lastIndex)}
        step={1}
        value={Math.min(gp.t, gp.lastIndex)}
        onChange={gp.seek}
        format={(v) => String(Math.round(v))}
        ariaLabel="Position de lecture"
      />
      <table>
        <tbody>
          <tr><th>Mouvement</th><td>{Math.round(gp.t)} / {gp.lastIndex}</td></tr>
          <tr><th>X / Y</th><td>{num(cur?.x)} / {num(cur?.y)} mm</td></tr>
          <tr><th>Z</th><td>{num(cur?.z)} mm</td></tr>
          <tr><th>B / C</th><td>{num(cur?.b, 1)}° / {num(cur?.c, 1)}°</td></tr>
        </tbody>
      </table>
      <Check checked={gp.showFullHead} onChange={gp.setShowFullHead}>Afficher la tête d&apos;outil complète</Check>
    </Section>
  );
};

const LineTypesSection: React.FC<{ gp: GCodePreview; info: GCodeInfo }> = ({ gp, info }) => (
  <Section title="Types de ligne">
    <table>
      <thead><tr><th /><th>Type</th><th>Durée</th><th>Filament</th><th>Masse</th></tr></thead>
      <tbody>
        {LINE_TYPES.map((lt) => {
          const st = info.lineStats[lt.id];
          return (
            <tr key={lt.id}>
              <td><input type="checkbox" checked={gp.lineVisibility[lt.id]} onChange={(e) => gp.setLineVisible(lt.id, e.target.checked)} /></td>
              <td><span className={styles.swatch} style={{ background: lt.color }} /> {lt.label}</td>
              <td>{st ? fmtTime(st.time) : '-'}</td>
              <td>{st ? `${num(st.filamentMm / 1000)} m` : '-'}</td>
              <td>{st ? `${num(st.massG)} g` : '-'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </Section>
);

const ConversionSection: React.FC<{ gp: GCodePreview; dropOffPlate: boolean; setDropOffPlate: (v: boolean) => void }> = ({ gp, dropOffPlate, setDropOffPlate }) => {
  if (!(gp.conversionAvailable && gp.conversionSource)) return null;
  return (
    <Section title="Conversion polaire">
      <p className={styles.note}>
        G-code 3 axes{gp.conversionSource.nonPlanar ? ' non plan' : ''} : convertissable pour l&apos;Apex.
      </p>
      {gp.conversionSource.offPlateTraits > 0 && (
        <Check checked={dropOffPlate} onChange={setDropOffPlate}>
          Supprimer les {gp.conversionSource.offPlateTraits} traits hors plateau
        </Check>
      )}
      <div className={styles.row}>
        <button type="button" disabled={gp.conversion.status === 'running'} onClick={() => gp.convert('polar', dropOffPlate)}>Convertir (polaire)</button>
        <button type="button" disabled={gp.conversion.status === 'running'} onClick={() => gp.convert('dynamic', dropOffPlate)}>Convertir (angle dynamique)</button>
      </div>
      {gp.conversion.status === 'running' && <p>Conversion : {Math.round(gp.conversion.progress)} %</p>}
      {gp.conversion.error && <p>Erreur : {gp.conversion.error}</p>}
    </Section>
  );
};

const ColorationBody: React.FC<{ gp: GCodePreview; dropOffPlate: boolean; setDropOffPlate: (v: boolean) => void }> = ({ gp, dropOffPlate, setDropOffPlate }) => {
  const info = gp.fileInfo;
  return (
    <>
      <FileSection gp={gp} />

      {info && (
        <>
          <PlaybackSection gp={gp} />

          <Section title="Coloration">
            <select value={gp.colorBy} onChange={(e) => gp.setColorBy(e.target.value as ColorByMode)}>
              <option value="lineType">Type de ligne</option>
              {Object.entries(COLOR_BY_LABELS).map(([mode, label]) => <option key={mode} value={mode}>{label}</option>)}
            </select>
          </Section>

          <LineTypesSection gp={gp} info={info} />

          <ConversionSection gp={gp} dropOffPlate={dropOffPlate} setDropOffPlate={setDropOffPlate} />

          <Section title="Export">
            <button type="button" disabled={!gp.canExport} onClick={gp.exportGCode}>Exporter le G-code</button>
            {!gp.canExport && <p className={styles.note}>Seul un G-code polaire s&apos;exporte pour l&apos;Apex.</p>}
          </Section>
        </>
      )}
    </>
  );
};

export const PreviewPanel: React.FC<{ gp: GCodePreview; previewTab: string; dropOffPlate: boolean; setDropOffPlate: (v: boolean) => void }> = ({ gp, previewTab, dropOffPlate, setDropOffPlate }) => (
  <>
    <div className={styles.row}>
      <button type="button" className={previewTab !== 'edition' ? styles.active : ''} onClick={() => setPreviewTab('coloration')}>Coloration</button>
      <button type="button" className={previewTab === 'edition' ? styles.active : ''} onClick={() => setPreviewTab('edition')}>Édition</button>
    </div>

    {previewTab === 'edition' ? (
      <div className={styles.edition}><EditionPanel /></div>
    ) : (
      <ColorationBody gp={gp} dropOffPlate={dropOffPlate} setDropOffPlate={setDropOffPlate} />
    )}
  </>
);
