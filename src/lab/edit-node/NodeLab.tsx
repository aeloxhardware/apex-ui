import React, { useState } from 'react';
import EditNode from '@/components/edit-node/EditNode';
import styles from './NodeLab.module.scss';

/**
 * Banc d'essai du nœud d'édition : fond du viewport, une ancre au centre, rien d'autre. Sert à
 * concevoir l'élément d'interface pas à pas avant de le brancher sur le viewport et le noyau C++.
 * Clic : sélection. Double-clic : rognage. Clic sur le fond : désélection.
 */
const NodeLab: React.FC = () => {
  const [active, setActive] = useState(false);
  const [trimming, setTrimming] = useState(false);

  return (
    <div className={styles.lab} onClick={() => setActive(false)}>
      <div className={styles.stage}>
        <EditNode
          x={0}
          y={0}
          active={active}
          trimming={trimming}
          onActivate={() => setActive(true)}
          onToggleTrimming={() => setTrimming((t) => !t)}
        />
      </div>
      <div className={styles.status} onClick={(e) => e.stopPropagation()}>
        <span>{active ? 'actif' : 'inactif'}</span>
        <span>rognage {trimming ? 'activé' : 'désactivé'}</span>
      </div>
    </div>
  );
};

export default NodeLab;
