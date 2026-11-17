import React, { useRef } from 'react';
import { motion } from 'framer-motion';
import { ExternalScrollArea } from './ExternalScrollArea';
import { GlassPanelBackdrop } from './edit-node/GlassPanelBackdrop';
import { CustomTooltip } from './CustomTooltip';
import { ApexButton } from './apex-ui';
import { ArrowLeft, ChevronRight } from '@/lib/icons';
import {
  KEY_GROUPS,
  buildShortcutTree,
  countAssigned,
  shortcutFor,
  shortcutsOf,
  type ShortcutNode,
} from '@/utils/shortcuts';
import styles from './ShortcutsPage.module.scss';

const TREE = buildShortcutTree();

const KeyCell: React.FC<{ node: ShortcutNode; keyId: string }> = ({ node, keyId }) => {
  const def = shortcutFor(node.mods, keyId);
  return (
    <li className={def ? styles.cell : `${styles.cell} ${styles.free}`}>
      <kbd className={styles.cap}>{keyId}</kbd>
      <span className={styles.action}>
        {def ? (
          <>
            <strong>{def.label}</strong>
            <span className={styles.desc}>{def.desc}</span>
          </>
        ) : (
          'Non attribué'
        )}
      </span>
    </li>
  );
};

const MouseRows: React.FC<{ node: ShortcutNode }> = ({ node }) => {
  const mouse = shortcutsOf(node.mods).filter((d) => d.mouse);
  if (mouse.length === 0) return null;
  return (
    <>
      <h4 className={styles.groupTitle}>Avec la souris</h4>
      <ul className={styles.grid}>
        {mouse.map((d) => (
          <li key={d.key} className={styles.cell}>
            <kbd className={styles.cap}>{d.key}</kbd>
            <span className={styles.action}>
              <strong>{d.label}</strong>
              <span className={styles.desc}>{d.desc}</span>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
};

/** Un nœud de l'arbre : combinaison de modificateurs, ses touches, puis ses sous-combinaisons. */
const TreeNode: React.FC<{ node: ShortcutNode }> = ({ node }) => {
  const total = countAssigned(node);
  return (
    <details className={styles.node} open={shortcutsOf(node.mods).length > 0}>
      <summary className={styles.summary}>
        <ChevronRight size={14} className={styles.chevron} />
        <span className={styles.nodeTitle}>{node.title}</span>
        <span className={styles.count}>{total === 0 ? 'aucun raccourci' : `${total} attribué${total > 1 ? 's' : ''}`}</span>
      </summary>
      <div className={styles.nodeBody}>
        {node.children.map((c) => (
          <TreeNode key={c.id} node={c} />
        ))}
        <MouseRows node={node} />
        {KEY_GROUPS.map((g) => (
          <section key={g.title}>
            <h4 className={styles.groupTitle}>{g.title}</h4>
            <ul className={styles.grid}>
              {g.keys.map((k) => (
                <KeyCell key={k} node={node} keyId={k} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </details>
  );
};

/** Page « Raccourcis » de l'Accueil : arbre Touche seule / Ctrl / Maj / Alt, combinaisons, puis toutes les touches. */
export const ShortcutsPage: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const panelRef = useRef<HTMLElement>(null);
  return (
    <>
      <GlassPanelBackdrop targetRef={panelRef} corner={20} warp={1.3} blurPx={5} distortion={8} whiteRim />
      <motion.section
        ref={panelRef}
        className={styles.panel}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 16 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      >
        <ExternalScrollArea className={styles.scrollArea} contentClassName={styles.content}>
          <CustomTooltip inline content="Retour à l'Accueil" description="Quitte la liste des raccourcis.">
            <ApexButton size="sm" onClick={onBack}>
              <ArrowLeft size={14} /> Accueil
            </ApexButton>
          </CustomTooltip>
          <h2 className={styles.title}>Raccourcis</h2>
          <p className={styles.subtitle}>
            Toutes les touches, rangées par modificateur. Les touches grisées ne sont pas attribuées.
          </p>
          {TREE.map((n) => (
            <TreeNode key={n.id} node={n} />
          ))}
        </ExternalScrollArea>
      </motion.section>
    </>
  );
};
