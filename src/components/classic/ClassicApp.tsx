import React, { useEffect, useRef, useState } from 'react';
import { Viewport3D } from '@/components/Viewport3D';
import { usePreviewTab } from '@/components/PreviewUpperTabs';
import { useGCodePreview } from '@/hooks/use-gcode-preview';
import { APP_TAGLINE_DEV, APP_TAGLINE_PREVIEW, setDevModeEnabled, useDevMode } from '@/utils/devModePrefs';
import { isEditJournalEnabled, setEditJournalEnabled, subscribeEditJournal } from '@/utils/editJournalPrefs';
import { getLaunchInterfaceMode, getStoredInterfaceMode, relaunchApp, setStoredInterfaceMode } from '@/utils/interfaceMode';
import { getStartPage } from '@/utils/startPagePrefs';
import { setPlateShaded, usePlateShaded } from '@/utils/plateShadingPrefs';
import { removeNotification, subscribeToNotifications, type NotificationItem } from '@/utils/notificationStore';
import { FlatUi } from './FlatUi';
import { Check, Section, PrepPanel, PreviewPanel, VIEWS, emit } from './ClassicPanels';
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
  { id: 'prep', label: 'Préparation' },
  { id: 'preview', label: 'Prévisualisation' },
  { id: 'modeling', label: 'Modélisation', devOnly: true },
  { id: 'dev', label: 'Dev', devOnly: true },
  { id: 'params', label: 'Paramètres' },
];

/** Accueil : présentation et promesse. */
const HomePage: React.FC<{ devMode: boolean }> = ({ devMode }) => (
    <div className={styles.page}>
      <Section title="Apex Studio">
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
);

/** Paramètres : interface au prochain lancement, journal des modifications, mode dev. */
const ParamsPage: React.FC<{ devMode: boolean; editJournal: boolean }> = ({ devMode, editJournal }) => {
  const [classicNext, setClassicNext] = useState(() => getStoredInterfaceMode() === 'classic');
  return (
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
  );
};

const ClassicApp: React.FC = () => {
  const devMode = useDevMode();
  // Page de démarrage (Paramètres) ; l'effet plus bas ramène à l'Accueil un espace indisponible.
  const [tab, setTab] = useState<Tab>(() => {
    const page = getStartPage();
    return page === 'prepare' ? 'prep' : page === 'home' ? 'home' : page;
  });
  const [tool, setTool] = useState('select');
  const [messages, setMessages] = useState<NotificationItem[]>([]);
  const [model, setModel] = useState<{ name: string; dimensions?: { x: number; y: number; z: number } | undefined } | null>(null);
  const [viewportUsed, setViewportUsed] = useState(false);
  const previewActive = tab === 'preview';
  const gp = useGCodePreview(previewActive);
  const previewTab = usePreviewTab();
  const plateShaded = usePlateShaded();
  const importRef = useRef<HTMLInputElement>(null);
  const [dropOffPlate, setDropOffPlate] = useState(false);
  const [editJournal, setEditJournal] = useState(isEditJournalEnabled);

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

  // Sans mode dev, seuls Accueil, Préparation, Prévisualisation et Paramètres existent (cf. CLAUDE.md, « Dev value »).
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
        {tab === 'home' && <HomePage devMode={devMode} />}

        {tab === 'params' && <ParamsPage devMode={devMode} editJournal={editJournal} />}

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
              {tab === 'prep' && <PrepPanel model={model} tool={tool} setTool={setTool} importRef={importRef} />}

              {tab === 'preview' && <PreviewPanel gp={gp} previewTab={previewTab} dropOffPlate={dropOffPlate} setDropOffPlate={setDropOffPlate} />}

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