import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { FolderOpen, Save } from '@/lib/icons';
import { usePortalRoot } from '@/components/GpuWarningFrame';
import { emitApex } from '@/events/apexEvents';
import { isProjectDirty } from '@/utils/projectSave';
import { CustomTooltip } from './CustomTooltip';
import buttonStyles from './FileSidebar.module.scss';
import styles from './FileMenu.module.scss';

interface FileMenuProps {
  onOpenProject?: (() => void) | undefined;
  onSaveProject?: (() => void) | undefined;
}

interface Entry {
  label: string;
  /** Texte du bandeau du bas. */
  desc: string;
  icon?: React.ReactNode;
  shortcut?: string;
  /** Sous-menu (flèche) : pas encore branché. */
  arrow?: boolean;
  run?: (() => void) | undefined;
  disabled?: boolean;
  /** Séparateur avant l'entrée. */
  separated?: boolean;
}

const SOON = 'Arrive bientôt.';
const GAP = 8;

/** Entrées du menu Fichier : celles sans action restent inertes (grisées) tant qu'elles ne sont pas branchées. */
function entriesOf({ onOpenProject, onSaveProject }: FileMenuProps, canSave: boolean): Entry[] {
  return [
    { label: 'Nouveau projet', desc: SOON, disabled: true },
    { label: 'Ouvrir un projet…', desc: 'Charge un projet enregistré précédemment.', icon: <FolderOpen size={14} />, run: onOpenProject },
    { label: 'Fichiers récents', desc: SOON, arrow: true, disabled: true },
    {
      label: 'Enregistrer le projet',
      desc: 'Enregistre le projet en 3MF dans le répertoire dédié.',
      icon: <Save size={14} />,
      shortcut: 'Ctrl+S',
      run: onSaveProject,
      disabled: !canSave,
      separated: true,
    },
    {
      label: 'Enregistrer le projet sous…',
      desc: 'Enregistre une nouvelle copie du projet en 3MF dans le répertoire dédié.',
      icon: <Save size={14} />,
      shortcut: 'Ctrl+Maj+S',
      run: onSaveProject,
    },
    { label: 'Importer', desc: SOON, arrow: true, disabled: true, separated: true },
    { label: 'Exporter', desc: SOON, arrow: true, disabled: true },
    {
      label: 'Quitter',
      desc: 'Ferme Apex (le projet modifié est enregistré avant la fermeture).',
      run: () => window.close(),
      separated: true,
    },
  ];
}

/** Bouton « Fichier » de la barre de fichiers et son menu déroulant, qui s'ouvre en dessous. */
export const FileMenu: React.FC<FileMenuProps> = (props) => {
  const portalRoot = usePortalRoot();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  // « Enregistrer le projet » n'a de sens que si le projet a changé : lu à l'ouverture.
  const [canSave, setCanSave] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const toggle = () => {
    const button = buttonRef.current;
    const bar = button?.closest('[data-apex-toolbar-bar]')?.getBoundingClientRect() ?? button?.getBoundingClientRect();
    const root = portalRoot.getBoundingClientRect();
    if (bar) setPos({ top: bar.bottom + GAP - root.top, left: bar.left - root.left });
    setCanSave(isProjectDirty());
    setOpen((v) => !v);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !buttonRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Raccourcis affichés dans le menu : seuls ceux qui sont branchés y figurent.
  const saveRef = useRef(props.onSaveProject);
  saveRef.current = props.onSaveProject;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 's') return;
      if (!e.shiftKey && !isProjectDirty()) return;
      e.preventDefault();
      saveRef.current?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const tip = (entry: Entry) => ({
    onMouseEnter: () => emitApex('apex-set-tooltip', { title: entry.label, desc: entry.desc }),
    onMouseLeave: () => emitApex('apex-reset-tooltip'),
  });

  return (
    <>
      <CustomTooltip content="Fichier" description="Ouvre le menu Fichier : projets, import, export et fermeture de l'application.">
        <button
          ref={buttonRef}
          type="button"
          className={clsx(buttonStyles.button)}
          onClick={toggle}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Fichier"
        >
          <FolderOpen size={18} />
        </button>
      </CustomTooltip>
      {open &&
        createPortal(
          <div ref={menuRef} className={styles.menu} style={{ top: pos.top, left: pos.left }} role="menu" data-apex-chrome-panel>
            {entriesOf(props, canSave).map((entry) => (
              <React.Fragment key={entry.label}>
                {entry.separated && <div className={styles.separator} />}
                <button
                  type="button"
                  role="menuitem"
                  className={styles.item}
                  disabled={entry.disabled}
                  onClick={() => {
                    setOpen(false);
                    entry.run?.();
                  }}
                  {...tip(entry)}
                >
                  <span className={styles.icon}>{entry.icon}</span>
                  <span className={styles.label}>{entry.label}</span>
                  {entry.shortcut && <span className={styles.shortcut}>{entry.shortcut}</span>}
                  {entry.arrow && <span className={styles.arrow}>›</span>}
                </button>
              </React.Fragment>
            ))}
          </div>,
          portalRoot,
        )}
    </>
  );
};
