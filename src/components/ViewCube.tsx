import React, { useEffect, useState } from 'react';
import styles from './ViewCube.module.scss';
import { CustomTooltip } from './CustomTooltip';
import { showSuccess } from '@/utils/toast';

export const ViewCube: React.FC = () => {
  const [rotation, setRotation] = useState({ x: -25, y: 45 });
  const [hoveredElement, setHoveredElement] = useState<string | null>(null);

  useEffect(() => {
    const handleCameraUpdated = (e: CustomEvent<{ alpha: number; beta: number }>) => {
      if (e.detail) {
        const { alpha, beta } = e.detail;
        const rotY = 90 - (alpha * 180) / Math.PI;
        const rotX = (beta * 180) / Math.PI - 90;
        setRotation({ x: rotX, y: rotY });
      }
    };

    window.addEventListener('apex-camera-updated', handleCameraUpdated as EventListener);
    return () => {
      window.removeEventListener('apex-camera-updated', handleCameraUpdated as EventListener);
    };
  }, []);

  const triggerView = (viewName: string, alpha: number, beta: number) => {
    window.dispatchEvent(
      new CustomEvent('apex-set-camera-custom', {
        detail: { alpha, beta }
      })
    );
    showSuccess(`Vue orientée : ${viewName}`);
  };

  // Angles isométriques exacts pour les 8 sommets du cube
  // FRONT-TOP-RIGHT (Sommet avant haut droit) : alpha = Math.PI / 4, beta = Math.PI / 4
  const CORNER_VIEWS: Record<string, { name: string; alpha: number; beta: number }> = {
    'top-front-right': { name: 'Sommet Haut-Avant-Droite', alpha: Math.PI / 4, beta: Math.PI / 4 },
    'top-front-left': { name: 'Sommet Haut-Avant-Gauche', alpha: (3 * Math.PI) / 4, beta: Math.PI / 4 },
    'top-back-right': { name: 'Sommet Haut-Arrière-Droite', alpha: -Math.PI / 4, beta: Math.PI / 4 },
    'top-back-left': { name: 'Sommet Haut-Arrière-Gauche', alpha: (-3 * Math.PI) / 4, beta: Math.PI / 4 },
    'bottom-front-right': { name: 'Sommet Bas-Avant-Droite', alpha: Math.PI / 4, beta: (3 * Math.PI) / 4 },
    'bottom-front-left': { name: 'Sommet Bas-Avant-Gauche', alpha: (3 * Math.PI) / 4, beta: (3 * Math.PI) / 4 },
    'bottom-back-right': { name: 'Sommet Bas-Arrière-Droite', alpha: -Math.PI / 4, beta: (3 * Math.PI) / 4 },
    'bottom-back-left': { name: 'Sommet Bas-Arrière-Gauche', alpha: (-3 * Math.PI) / 4, beta: (3 * Math.PI) / 4 },
  };

  return (
    <div className={styles.container}>
      <CustomTooltip content="ViewCube 3D" description="Cliquez sur une face, une arête ou un sommet pour orienter instantanément la caméra 3D.">
        <div 
          className={styles.cube}
          style={{
            transform: `rotateX(${rotation.x}deg) rotateY(${rotation.y}deg)`
          }}
        >
          {/* FRONT FACE */}
          <div className={`${styles.face} ${styles.front}`}>
            <div 
              className={`${styles.vertex} ${styles.vertexTL} ${hoveredElement === 'top-front-left' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredElement('top-front-left')}
              onMouseLeave={() => setHoveredElement(null)}
              onClick={() => triggerView(CORNER_VIEWS['top-front-left'].name, CORNER_VIEWS['top-front-left'].alpha, CORNER_VIEWS['top-front-left'].beta)} 
            />
            <div 
              className={`${styles.vertex} ${styles.vertexTR} ${hoveredElement === 'top-front-right' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredElement('top-front-right')}
              onMouseLeave={() => setHoveredElement(null)}
              onClick={() => triggerView(CORNER_VIEWS['top-front-right'].name, CORNER_VIEWS['top-front-right'].alpha, CORNER_VIEWS['top-front-right'].beta)} 
            />
            <div 
              className={`${styles.vertex} ${styles.vertexBL} ${hoveredElement === 'bottom-front-left' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredElement('bottom-front-left')}
              onMouseLeave={() => setHoveredElement(null)}
              onClick={() => triggerView(CORNER_VIEWS['bottom-front-left'].name, CORNER_VIEWS['bottom-front-left'].alpha, CORNER_VIEWS['bottom-front-left'].beta)} 
            />
            <div 
              className={`${styles.vertex} ${styles.vertexBR} ${hoveredElement === 'bottom-front-right' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredElement('bottom-front-right')}
              onMouseLeave={() => setHoveredElement(null)}
              onClick={() => triggerView(CORNER_VIEWS['bottom-front-right'].name, CORNER_VIEWS['bottom-front-right'].alpha, CORNER_VIEWS['bottom-front-right'].beta)} 
            />
            <div className={`${styles.edge} ${styles.edgeTop}`} onClick={() => triggerView('Arête Haut-Avant', Math.PI / 2, Math.PI / 4)} />
            <div className={`${styles.edge} ${styles.edgeBottom}`} onClick={() => triggerView('Arête Bas-Avant', Math.PI / 2, (3 * Math.PI) / 4)} />
            <div className={`${styles.edge} ${styles.edgeLeft}`} onClick={() => triggerView('Arête Gauche-Avant', (3 * Math.PI) / 4, Math.PI / 2)} />
            <div className={`${styles.edge} ${styles.edgeRight}`} onClick={() => triggerView('Arête Droite-Avant', Math.PI / 4, Math.PI / 2)} />
            <div className={styles.centerPart} onClick={() => triggerView('FRONT', Math.PI / 2, Math.PI / 2)}>FRONT</div>
          </div>

          {/* BACK FACE */}
          <div className={`${styles.face} ${styles.back}`}>
            <div 
              className={`${styles.vertex} ${styles.vertexTL} ${hoveredElement === 'top-back-right' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredElement('top-back-right')}
              onMouseLeave={() => setHoveredElement(null)}
              onClick={() => triggerView(CORNER_VIEWS['top-back-right'].name, CORNER_VIEWS['top-back-right'].alpha, CORNER_VIEWS['top-back-right'].beta)} 
            />
            <div 
              className={`${styles.vertex} ${styles.vertexTR} ${hoveredElement === 'top-back-left' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredElement('top-back-left')}
              onMouseLeave={() => setHoveredElement(null)}
              onClick={() => triggerView(CORNER_VIEWS['top-back-left'].name, CORNER_VIEWS['top-back-left'].alpha, CORNER_VIEWS['top-back-left'].beta)} 
            />
            <div 
              className={`${styles.vertex} ${styles.vertexBL} ${hoveredElement === 'bottom-back-right' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredElement('bottom-back-right')}
              onMouseLeave={() => setHoveredElement(null)}
              onClick={() => triggerView(CORNER_VIEWS['bottom-back-right'].name, CORNER_VIEWS['bottom-back-right'].alpha, CORNER_VIEWS['bottom-back-right'].beta)} 
            />
            <div 
              className={`${styles.vertex} ${styles.vertexBR} ${hoveredElement === 'bottom-back-left' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredElement('bottom-back-left')}
              onMouseLeave={() => setHoveredElement(null)}
              onClick={() => triggerView(CORNER_VIEWS['bottom-back-left'].name, CORNER_VIEWS['bottom-back-left'].alpha, CORNER_VIEWS['bottom-back-left'].beta)} 
            />
            <div className={`${styles.edge} ${styles.edgeTop}`} onClick={() => triggerView('Arête Haut-Arrière', -Math.PI / 2, Math.PI / 4)} />
            <div className={`${styles.edge} ${styles.edgeBottom}`} onClick={() => triggerView('Arête Bas-Arrière', -Math.PI / 2, (3 * Math.PI) / 4)} />
            <div className={`${styles.edge} ${styles.edgeLeft}`} onClick={() => triggerView('Arête Gauche-Arrière', -Math.PI / 4, Math.PI / 2)} />
            <div className={`${styles.edge} ${styles.edgeRight}`} onClick={() => triggerView('Arête Droite-Arrière', (-3 * Math.PI) / 4, Math.PI / 2)} />
            <div className={styles.centerPart} onClick={() => triggerView('BACK', -Math.PI / 2, Math.PI / 2)}>BACK</div>
          </div>

          {/* RIGHT FACE */}
          <div className={`${styles.face} ${styles.right}`}>
            <div 
              className={`${styles.vertex} ${styles.vertexTL} ${hoveredElement === 'top-back-right' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredElement('top-back-right')}
              onMouseLeave={() => setHoveredElement(null)}
              onClick={() => triggerView(CORNER_VIEWS['top-back-right'].name, CORNER_VIEWS['top-back-right'].alpha, CORNER_VIEWS['top-back-right'].beta)} 
            />
            <div 
              className={`${styles.vertex} ${styles.vertexTR} ${hoveredElement === 'top-front-right' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredElement('top-front-right')}
              onMouseLeave={() => setHoveredElement(null)}
              onClick={() => triggerView(CORNER_VIEWS['top-front-right'].name, CORNER_VIEWS['top-front-right'].alpha, CORNER_VIEWS['top-front-right'].beta)} 
            />
            <div 
              className={`${styles.vertex} ${styles.vertexBL} ${hoveredElement === 'bottom-back-right' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredElement('bottom-back-right')}
              onMouseLeave={() => setHoveredElement(null)}
              onClick={() => triggerView(CORNER_VIEWS['bottom-back-right'].name, CORNER_VIEWS['bottom-back-right'].alpha, CORNER_VIEWS['bottom-back-right'].beta)} 
            />
            <div 
              className={`${styles.vertex} ${styles.vertexBR} ${hoveredElement === 'bottom-front-right' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredElement('bottom-front-right')}
              onMouseLeave={() => setHoveredElement(null)}
              onClick={() => triggerView(CORNER_VIEWS['bottom-front-right'].name, CORNER_VIEWS['bottom-front-right'].alpha, CORNER_VIEWS['bottom-front-right'].beta)} 
            />
            <div className={`${styles.edge} ${styles.edgeTop}`} onClick={() => triggerView('Arête Haut-Droite', 0, Math.PI / 4)} />
            <div className={`${styles.edge} ${styles.edgeBottom}`} onClick={() => triggerView('Arête Bas-Droite', 0, (3 * Math.PI) / 4)} />
            <div className={`${styles.edge} ${styles.edgeLeft}`} onClick={() => triggerView('Arête Gauche-Droite', -Math.PI / 2, Math.PI / 2)} />
            <div className={`${styles.edge} ${styles.edgeRight}`} onClick={() => triggerView('Arête Droite-Droite', 0, Math.PI / 2)} />
            <div className={styles.centerPart} onClick={() => triggerView('RIGHT', 0, Math.PI / 2)}>RIGHT</div>
          </div>

          {/* LEFT FACE */}
          <div className={`${styles.face} ${styles.left}`}>
            <div 
              className={`${styles.vertex} ${styles.vertexTL} ${hoveredElement === 'top-front-left' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredElement('top-front-left')}
              onMouseLeave={() => setHoveredElement(null)}
              onClick={() => triggerView(CORNER_VIEWS['top-front-left'].name, CORNER_VIEWS['top-front-left'].alpha, CORNER_VIEWS['top-front-left'].beta)} 
            />
            <div 
              className={`${styles.vertex} ${styles.vertexTR} ${hoveredElement === 'top-back-left' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredElement('top-back-left')}
              onMouseLeave={() => setHoveredElement(null)}
              onClick={() => triggerView(CORNER_VIEWS['top-back-left'].name, CORNER_VIEWS['top-back-left'].alpha, CORNER_VIEWS['top-back-left'].beta)} 
            />
            <div 
              className={`${styles.vertex} ${styles.vertexBL} ${hoveredElement === 'bottom-front-left' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredElement('bottom-front-left')}
              onMouseLeave={() => setHoveredElement(null)}
              onClick={() => triggerView(CORNER_VIEWS['bottom-front-left'].name, CORNER_VIEWS['bottom-front-left'].alpha, CORNER_VIEWS['bottom-front-left'].beta)} 
            />
            <div 
              className={`${styles.vertex} ${styles.vertexBR} ${hoveredElement === 'bottom-back-left' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredElement('bottom-back-left')}
              onMouseLeave={() => setHoveredElement(null)}
              onClick={() => triggerView(CORNER_VIEWS['bottom-back-left'].name, CORNER_VIEWS['bottom-back-left'].alpha, CORNER_VIEWS['bottom-back-left'].beta)} 
            />
            <div className={`${styles.edge} ${styles.edgeTop}`} onClick={() => triggerView('Arête Haut-Gauche', Math.PI, Math.PI / 4)} />
            <div className={`${styles.edge} ${styles.edgeBottom}`} onClick={() => triggerView('Arête Bas-Gauche', Math.PI, (3 * Math.PI) / 4)} />
            <div className={`${styles.edge} ${styles.edgeLeft}`} onClick={() => triggerView('Arête Gauche-Gauche', Math.PI / 2, Math.PI / 2)} />
            <div className={`${styles.edge} ${styles.edgeRight}`} onClick={() => triggerView('Arête Droite-Gauche', Math.PI, Math.PI / 2)} />
            <div className={styles.centerPart} onClick={() => triggerView('LEFT', Math.PI, Math.PI / 2)}>LEFT</div>
          </div>

          {/* TOP FACE */}
          <div className={`${styles.face} ${styles.top}`}>
            <div 
              className={`${styles.vertex} ${styles.vertexTL} ${hoveredElement === 'top-back-left' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredElement('top-back-left')}
              onMouseLeave={() => setHoveredElement(null)}
              onClick={() => triggerView(CORNER_VIEWS['top-back-left'].name, CORNER_VIEWS['top-back-left'].alpha, CORNER_VIEWS['top-back-left'].beta)} 
            />
            <div 
              className={`${styles.vertex} ${styles.vertexTR} ${hoveredElement === 'top-back-right' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredElement('top-back-right')}
              onMouseLeave={() => setHoveredElement(null)}
              onClick={() => triggerView(CORNER_VIEWS['top-back-right'].name, CORNER_VIEWS['top-back-right'].alpha, CORNER_VIEWS['top-back-right'].beta)} 
            />
            <div 
              className={`${styles.vertex} ${styles.vertexBL} ${hoveredElement === 'top-front-left' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredElement('top-front-left')}
              onMouseLeave={() => setHoveredElement(null)}
              onClick={() => triggerView(CORNER_VIEWS['top-front-left'].name, CORNER_VIEWS['top-front-left'].alpha, CORNER_VIEWS['top-front-left'].beta)} 
            />
            <div 
              className={`${styles.vertex} ${styles.vertexBR} ${hoveredElement === 'top-front-right' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredElement('top-front-right')}
              onMouseLeave={() => setHoveredElement(null)}
              onClick={() => triggerView(CORNER_VIEWS['top-front-right'].name, CORNER_VIEWS['top-front-right'].alpha, CORNER_VIEWS['top-front-right'].beta)} 
            />
            <div className={`${styles.edge} ${styles.edgeTop}`} onClick={() => triggerView('Arête Haut-Top', Math.PI / 2, 0.01)} />
            <div className={`${styles.edge} ${styles.edgeBottom}`} onClick={() => triggerView('Arête Bas-Top', -Math.PI / 2, 0.01)} />
            <div className={`${styles.edge} ${styles.edgeLeft}`} onClick={() => triggerView('Arête Gauche-Top', Math.PI, 0.01)} />
            <div className={`${styles.edge} ${styles.edgeRight}`} onClick={() => triggerView('Arête Droite-Top', 0, 0.01)} />
            <div className={styles.centerPart} onClick={() => triggerView('TOP', Math.PI / 2, 0.01)}>TOP</div>
          </div>

          {/* BOTTOM FACE */}
          <div className={`${styles.face} ${styles.bottom}`}>
            <div 
              className={`${styles.vertex} ${styles.vertexTL} ${hoveredElement === 'bottom-front-left' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredElement('bottom-front-left')}
              onMouseLeave={() => setHoveredElement(null)}
              onClick={() => triggerView(CORNER_VIEWS['bottom-front-left'].name, CORNER_VIEWS['bottom-front-left'].alpha, CORNER_VIEWS['bottom-front-left'].beta)} 
            />
            <div 
              className={`${styles.vertex} ${styles.vertexTR} ${hoveredElement === 'bottom-front-right' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredElement('bottom-front-right')}
              onMouseLeave={() => setHoveredElement(null)}
              onClick={() => triggerView(CORNER_VIEWS['bottom-front-right'].name, CORNER_VIEWS['bottom-front-right'].alpha, CORNER_VIEWS['bottom-front-right'].beta)} 
            />
            <div 
              className={`${styles.vertex} ${styles.vertexBL} ${hoveredElement === 'bottom-back-left' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredElement('bottom-back-left')}
              onMouseLeave={() => setHoveredElement(null)}
              onClick={() => triggerView(CORNER_VIEWS['bottom-back-left'].name, CORNER_VIEWS['bottom-back-left'].alpha, CORNER_VIEWS['bottom-back-left'].beta)} 
            />
            <div 
              className={`${styles.vertex} ${styles.vertexBR} ${hoveredElement === 'bottom-back-right' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredElement('bottom-back-right')}
              onMouseLeave={() => setHoveredElement(null)}
              onClick={() => triggerView(CORNER_VIEWS['bottom-back-right'].name, CORNER_VIEWS['bottom-back-right'].alpha, CORNER_VIEWS['bottom-back-right'].beta)} 
            />
            <div className={`${styles.edge} ${styles.edgeTop}`} onClick={() => triggerView('Arête Haut-Bottom', Math.PI / 2, Math.PI - 0.01)} />
            <div className={`${styles.edge} ${styles.edgeBottom}`} onClick={() => triggerView('Arête Bas-Bottom', -Math.PI / 2, Math.PI - 0.01)} />
            <div className={`${styles.edge} ${styles.edgeLeft}`} onClick={() => triggerView('Arête Gauche-Bottom', Math.PI, Math.PI - 0.01)} />
            <div className={`${styles.edge} ${styles.edgeRight}`} onClick={() => triggerView('Arête Droite-Bottom', 0, Math.PI - 0.01)} />
            <div className={styles.centerPart} onClick={() => triggerView('BOTTOM', Math.PI / 2, Math.PI - 0.01)}>BOTTOM</div>
          </div>
        </div>
      </CustomTooltip>
    </div>
  );
};