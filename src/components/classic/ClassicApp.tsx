import React, { useEffect, useRef, useState } from 'react';
import { Viewport3D } from '@/components/Viewport3D';
import { EditionPanel } from '@/components/edit-node/EditionPanel';
import { setPreviewTab, usePreviewTab } from '@/components/PreviewUpperTabs';
import { COLOR_BY_LABELS } from '@/components/gcodeColormap';
import { LINE_TYPES } from '@/components/gcodeLineTypes';
import type { ColorByMode } from '@/components/gcodeParse';
import { GCODE_ACCEPT, GCODE_SPEED_OPTIONS, useGCodePreview } from '@/hooks/use-gcode-preview';
import { APP_TAGLINE_DEV, APP_TAGLINE_PREVIEW, setDevModeEnabled, useDevMode } from '@/utils/devModePrefs';
import { isEditJournalEnabled, setEditJournalEnabled, subscribeEditJournal } from '@/utils/editJournalPrefs';
import { getLaunchInterfaceMode, relaunchApp, setStoredInterfaceMode } from '@/utils/interfaceMode';
import { getStartPage } from '@/utils/startPagePrefs';
import { setPlateShaded, usePlateShaded } from '@/utils/plateShadingPrefs';
import { removeNotification, subscribeToNotifications, type NotificationItem } from '@/utils/notificationStore';
import { FlatUi } from './FlatUi';
import styles from './ClassicApp.module.scss';

/**
 * Interface classique (cf. utils/interfaceMode.ts) : une interface SÉPARÉE de LiquidGlass — l'interface principale
 * (Index, panneaux de verre, rideaux, framer-motion) n'est jamais chargée. Mêmes espaces et même logique, mais noir et
 * blanc, coins droits, police système et aucune animation. Elle ne réutilise de l'interface principale que le moteur 3D
 * (Viewport3D), la logique G-code (useGCodePreview) et le panneau Édition, que FlatUi.tsx et styles/flat.css passent
 * en noir et blanc. Tout passe par les mêmes événements `apex-*` que l'interface principale.
 */

type Tab = 'home' | 'prep' | 'preview' | 'modeling' | 'dev' | 'params';

const ALL_TABS: { id: Tab; label: string; devOnly?: boolean }[] = [
  { id: 'home', label: 'Accueil' },
  { id: 'prep', label: 'Préparation', devOnly: true },
  { id: 'preview', label: 'Prévisualisation' },
  { id: 'modeling', label: 'Modélisation', devOnly: true },
  { id: 'dev', label: 'Dev', devOnly: true },
  { id: 'params', label: 'Paramètres' },
];

const TOOLS = [
  { id: 'select', label: 'Sélection' },
  { id: 'move', label: 'Déplacement' },
  { id: 'rotate', label: 'Rotation' },
  { id: 'scale', label: 'Échelle' },
];

const VIEWS = [
  { id: 'top', label: 'Dessus' },
  { id: 'front', label: 'Face' },
  { id: 'right', label: 'Droite' },
  { id: 'left', label: 'Gauche' },
  { id: 'back', label: 'Arrière' },
  { id: 'bottom', label: 'Dessous' },
];

const emit = (name: string, detail?: unknown) => window.dispatchEvent(new CustomEvent(name, { detail }));
const fmtTime = (s: number) => `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')} min ${String(Math.round(s % 60)).padStart(2, '0')} s`;
const num = (v: number | undefined, digits = 2) => (v === undefined || !Number.isFinite(v) ? '-' : v.toFixed(digits));

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className={styles.section}>
    <h3>{title}</h3>
    {children}
  </section>
);

const Check: React.FC<{ checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }> = ({ checked, onChange, children }) => (
  <label className={styles.check}>
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    <span>{children}</span>
  </label>
);

const ClassicApp: React.FC = () => {
  const devMode = useDevMode();
  // Page de démarrage (Paramètres) ; l'effet plus bas ramène à l'Accueil un espace indisponible.
  const [tab, setTab] = useState<Tab>(() => {
    const page = getStartPage();
    return page === 'prepare' ? 'prep' : page === 'home' ? 'home' : page;
  });
  const [tool, setTool] = useState('select');
  const [messages, setMessages] = useState<NotificationItem[]>([]);
  const [model, setModel] = useState<{ name: string; dimensions?: { x: number; y: number; z: number } } | null>(null);
  const [viewportUsed, setViewportUsed] = useState(false);
  const previewActive = tab === 'preview';
  const gp = useGCodePreview(previewActive);
  const previewTab = usePreviewTab();
  const plateShaded = usePlateShaded();
  const importRef = useRef<HTMLInputElement>(null);
  const [dropOffPlate, setDropOffPlate] = useState(false);
  const [editJournal, setEditJournal] = useState(isEditJournalEnabled);
  const [classicNext, setClassicNext] = useState(getLaunchInterfaceMode() === 'classic');

  useEffect(() => subscribeEditJournal(setEditJournal), []);
  useEffect(() => subscribeToNotifications((items) => setMessages(items)), []);
  // L'écran de démarrage attend ce signal (normalement envoyé par le fond de l'Accueil ou le viewport).
  useEffect(() => { window.dispatchEvent(new Event('apex-home-ready')); }, []);

  useEffect(() => {
    const onSelected = (e: Event) => {
      const d = (e as CustomEvent<{ name: string | null; dimensions?: { x: number; y: number; z: number } }>).detail;
      setModel(d?.name ? { name: d.name, dimensions: d.dimensions } : null);
    };
    window.addEventListener('apex-mesh-selected', onSelected);
    return () => window.removeEventListener('apex-mesh-selected', onSelected);
  }, []);

  // Sans mode dev, seuls Accueil, Prévisualisation et Paramètres existent (cf. CLAUDE.md, « Dev value »).
  const tabs = ALL_TABS.filter((t) => devMode || !t.devOnly);
  useEffect(() => {
    if (!tabs.some((t) => t.id === tab)) setTab('home');
  }, [tabs, tab]);

  const showViewport = tab === 'prep' || tab === 'preview';
  // Le viewport reste monté une fois ouvert (il ne retrouve pas un G-code chargé après un démontage) ; masqué, hors écran.
  // Monté dès l'entrée dans l'espace (pas un rendu plus tard) : ses écouteurs `apex-*` doivent exister avant l'effet ci-dessous.
  useEffect(() => { if (showViewport) setViewportUsed(true); }, [showViewport]);

  // Mêmes événements que Sidebar.tsx lors d'un changement d'espace.
  useEffect(() => {
    if (tab === 'preview') {
      emit('apex-tool-changed', { tool: 'layers' });
      emit('apex-preview-toggled', { active: true });
    } else if (tab === 'prep') {
      setTool('select');
      emit('apex-tool-changed', { tool: 'select' });
      emit('apex-preview-toggled', { active: false });
    }
  }, [tab]);

  const info = gp.fileInfo;
  const cur = gp.current;

  return (
    <div className={styles.root}>
      <FlatUi />
      <header className={styles.header}>
        <strong className={styles.title}>APEX</strong>
        <nav className={styles.tabs} role="tablist">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? styles.active : ''} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
        <span className={styles.version}>{__APEX_VERSION__} · interface classique</span>
      </header>

      <div className={styles.body}>
        {tab === 'home' && (
          <div className={styles.page}>
            <Section title="Apex Slicer Studio">
              <p>{devMode ? APP_TAGLINE_DEV : APP_TAGLINE_PREVIEW}</p>
              <p>Aelox Hardware</p>
            </Section>
            <Section title="Promesse">
              <p>
                Ce logiciel, ainsi que toutes ses versions, y compris les versions futures, sont et resteront gratuits et open-source,
                pour tout le monde et pour toujours, sous licence AGPL3. Cette promesse est verrouillée dans les statuts d&apos;Aelox Hardware.
              </p>
            </Section>
          </div>
        )}

        {tab === 'params' && (
          <div className={styles.page}>
            <Section title="Interface">
              <Check checked={classicNext} onChange={(v) => { setClassicNext(v); setStoredInterfaceMode(v ? 'classic' : 'liquid'); }}>
                Interface classique (noir et blanc, sans effets) au prochain lancement
              </Check>
              <p className={styles.note}>
                {classicNext ? 'Interface classique au prochain lancement.' : 'Interface LiquidGlass au prochain lancement.'}{' '}
                {(classicNext ? 'classic' : 'liquid') !== getLaunchInterfaceMode() && <button type="button" onClick={relaunchApp}>Relancer maintenant</button>}
              </p>
            </Section>
            <Section title="Prévisualisation G-code">
              <Check checked={editJournal} onChange={setEditJournalEnabled}>Enregistrer l&apos;historique des modifications dans le G-code</Check>
              <Check checked={devMode} onChange={setDevModeEnabled}>Mode dev (onglets Préparation, Modélisation et Dev, raccourcis du navigateur)</Check>
            </Section>
          </div>
        )}

        {(tab === 'modeling' || tab === 'dev') && (
          <div className={styles.page}>
            <Section title={tab === 'modeling' ? 'Modélisation' : 'Dev'}>
              <p>Cet espace n&apos;est pas disponible dans l&apos;interface classique. Passez à l&apos;interface LiquidGlass (Paramètres).</p>
            </Section>
          </div>
        )}

        {(viewportUsed || showViewport) && (
          <div className={`${styles.workspace} ${showViewport ? '' : styles.hidden}`}>
            <aside className={styles.side}>
              {tab === 'prep' && (
                <>
                  <Section title="Modèle">
                    <button type="button" onClick={() => importRef.current?.click()}>Importer un modèle (STL, GLB)…</button>
                    <input
                      ref={importRef}
                      type="file"
                      accept=".stl,.glb"
                      hidden
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) emit('apex-import-model', f); e.target.value = ''; }}
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
              )}

              {tab === 'preview' && (
                <>
                  <div className={styles.row}>
                    <button type="button" className={previewTab !== 'edition' ? styles.active : ''} onClick={() => setPreviewTab('coloration')}>Coloration</button>
                    <button type="button" className={previewTab === 'edition' ? styles.active : ''} onClick={() => setPreviewTab('edition')}>Édition</button>
                  </div>

                  {previewTab === 'edition' ? (
                    <div className={styles.edition}><EditionPanel /></div>
                  ) : (
                    <>
                      <Section title="Fichier G-code">
                        <button type="button" onClick={gp.openFilePicker} disabled={gp.isLoading}>{gp.isLoading ? 'Chargement…' : 'Ouvrir un G-code…'}</button>
                        {!info && <p className={styles.note}>Aucun G-code chargé : ouvrez-en un, ou déposez-le sur la fenêtre ({GCODE_ACCEPT}).</p>}
                        {info && (
                          <table>
                            <tbody>
                              <tr><th>Nom</th><td>{info.name}</td></tr>
                              <tr><th>Type</th><td>{info.kind === 'polar' ? 'Polaire (4 axes)' : 'Cartésien (3 axes)'}</td></tr>
                              <tr><th>Générateur</th><td>{info.generator ? `${info.generator.name}${info.generator.inferred ? ' (déduit)' : ''}` : '-'}</td></tr>
                              <tr><th>Imprimante</th><td>{info.printer ?? '-'}</td></tr>
                              <tr><th>Mouvements</th><td>{info.moves} (dont {info.extruding} en extrusion)</td></tr>
                              <tr><th>Durée</th><td>{fmtTime(info.totalTime)}</td></tr>
                              <tr><th>Z</th><td>{num(info.minZ)} à {num(info.maxZ)} mm</td></tr>
                              <tr><th>C</th><td>{num(info.minC, 1)} à {num(info.maxC, 1)}°</td></tr>
                            </tbody>
                          </table>
                        )}
                      </Section>

                      {info && (
                        <>
                          <Section title="Lecture">
                            <div className={styles.row}>
                              <button type="button" onClick={gp.togglePlay}>{gp.isPlaying ? 'Pause' : 'Lecture'}</button>
                              <select value={gp.speed} onChange={(e) => gp.setSpeed(Number(e.target.value))}>
                                {GCODE_SPEED_OPTIONS.map((s) => <option key={s} value={s}>{s}×</option>)}
                              </select>
                            </div>
                            <input
                              type="range"
                              className={styles.wide}
                              min={0}
                              max={Math.max(1, gp.lastIndex)}
                              step={1}
                              value={Math.min(gp.t, gp.lastIndex)}
                              onChange={(e) => gp.seek(Number(e.target.value))}
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

                          <Section title="Coloration">
                            <select value={gp.colorBy} onChange={(e) => gp.setColorBy(e.target.value as ColorByMode)}>
                              <option value="lineType">Type de ligne</option>
                              {Object.entries(COLOR_BY_LABELS).map(([mode, label]) => <option key={mode} value={mode}>{label}</option>)}
                            </select>
                          </Section>

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

                          {gp.conversionAvailable && gp.conversionSource && (
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
                          )}

                          <Section title="Export">
                            <button type="button" disabled={!gp.canExport} onClick={gp.exportGCode}>Exporter le G-code</button>
                            {!gp.canExport && <p className={styles.note}>Seul un G-code polaire s&apos;exporte pour l&apos;Apex.</p>}
                          </Section>
                        </>
                      )}
                    </>
                  )}
                </>
              )}

              <Section title="Vue">
                <div className={styles.row}>
                  {VIEWS.map((v) => <button key={v.id} type="button" onClick={() => emit('apex-set-camera-view', { view: v.id })}>{v.label}</button>)}
                </div>
                <Check checked={plateShaded} onChange={setPlateShaded}>Rendre le plateau avec ombres</Check>
                <div className={styles.row}>
                  <button type="button" onClick={() => emit('apex-fit-screen')}>Ajuster à l&apos;écran</button>
                  <button type="button" onClick={() => emit('apex-reset-camera')}>Réinitialiser</button>
                </div>
              </Section>
            </aside>
            <main className={styles.viewport}>
              <Viewport3D />
            </main>
          </div>
        )}
      </div>

      {messages.length > 0 && (
        <footer className={styles.messages}>
          <table>
            <tbody>
              {messages.slice(-4).map((m) => (
                <tr key={m.id}>
                  <th>{m.variant === 'error' ? 'ERREUR' : m.variant === 'warning' ? 'ATTENTION' : 'INFO'}</th>
                  <td>{m.message}</td>
                  <td className={styles.close}><button type="button" onClick={() => removeNotification(m.id)}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </footer>
      )}
    </div>
  );
};

export default ClassicApp;
