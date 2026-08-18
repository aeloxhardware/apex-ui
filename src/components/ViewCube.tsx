import React, { useEffect, useState } from 'react';
import styles from './ViewCube.module.scss';
import { CustomTooltip } from './CustomTooltip';
import { showSuccess } from '@/utils/toast';

export const ViewCube: React.FC = () => {
  const [rotation, setRotation] = useState({ x: -25, y: 45 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);

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

  // Cartographie exacte des 8 sommets isométriques du cube
  const CORNER_VIEWS: Record<string, { name: string; alpha: number; beta: number }> = {
    'top-front-right': { name: 'Sommet Haut-Avant-Droite', alpha: Math.PI / 4, beta: Math.PI / 4 },
    'top-front-left': { name: 'Sommet Haut-Avant-Gauche', alpha: (3 * Math.PI) / 4, beta: Math.PI / 4 },
    'top-back-right': { name: 'Sommet Haut-Arrière-Droite', alpha: -Math.PI / 4, beta: Math.PI / 4 },
    'top-back-left': { name: 'Sommet Haut-Arrière-Gauche', alpha: (-3 * Math.PI) / 4, beta: Math.PI / 4 },
    'bottom-front-right': { name: 'Sommet Bas-Avant-Droite', alpha: Math.PI / 4, beta: (3 * Math.PI) / 4 },
    'bottom-front-left': { name: 'Sommet Bas-Avant-Gauche', alpha: (5 * Math.PI) / 4, beta: (3 * Math.PI) / 4 },
    'bottom-back-right': { name: 'Sommet Bas-Arrière-Droite', alpha: -Math.PI / 4, beta: (3 * Math.PI) / 4 },
    'bottom-back-left': { name: 'Sommet Bas-Arrière-Gauche', alpha: (-5 * Math.PI) / 4, beta: (3 * Math.PI) / 4 },
  };

  // Cartographie des 12 arêtes du cube
  const EDGE_VIEWS: Record<string, { name: string; alpha: number; beta: number }> = {
    'top-front': { name: 'Arête Haut-Avant', alpha: Math.PI / 2, beta: Math.PI / 4 },
    'top-back': { name: 'Arête Haut-Arrière', alpha: -Math.PI / 2, beta: Math.PI / 4 },
    'top-left': { name: 'Arête Haut-Gauche', alpha: Math.PI, beta: Math.PI / 4 },
    'top-right': { name: 'Arête Haut-Droite', alpha: 0, beta: Math.PI / 4 },
    'bottom-front': { name: 'Arête Bas-Avant', alpha: Math.PI / 2, beta: (3 * Math.PI) / 4 },
    'bottom-back': { name: 'Arête Bas-Arrière', alpha: -Math.PI / 2, beta: (3 * Math.PI) / 4 },
    'bottom-left': { name: 'Arête Bas-Gauche', alpha: Math.PI, beta: (3 * Math.PI) / 4 },
    'bottom-right': { name: 'Arête Bas-Droite', alpha: 0, beta: (3 * Math.PI) / 4 },
    'front-left': { name: 'Arête Gauche-Avant', alpha: (3 * Math.PI) / 4, beta: Math.PI / 2 },
    'front-right': { name: 'Arête Droite-Avant', alpha: Math.PI / 4, beta: Math.PI / 2 },
    'back-left': { name: 'Arête Gauche-Arrière', alpha: (-3 * Math.PI) / 4, beta: Math.PI / 2 },
    'back-right': { name: 'Arête Droite-Arrière', alpha: -Math.PI / 4, beta: Math.PI / 2 },
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
              className={`${styles.vertex} ${styles.vertexTL} ${hoveredId === 'top-front-left' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredId('top-front-left')} onMouseLeave={() => setHoveredId(null)}
              onClick={() => triggerView(CORNER_VIEWS['top-front-left'].name, CORNER_VIEWS['top-front-left'].alpha, CORNER_VIEWS['top-front-left'].beta)} 
            />
            <div 
              className={`${styles.vertex} ${styles.vertexTR} ${hoveredId === 'top-front-right' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredId('top-front-right')} onMouseLeave={() => setHoveredId(null)}
              onClick={() => triggerView(CORNER_VIEWS['top-front-right'].name, CORNER_VIEWS['top-front-right'].alpha, CORNER_VIEWS['top-front-right'].beta)} 
            />
            <div 
              className={`${styles.vertex} ${styles.vertexBL} ${hoveredId === 'bottom-front-left' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredId('bottom-front-left')} onMouseLeave={() => setHoveredId(null)}
              onClick={() => triggerView(CORNER_VIEWS['bottom-front-left'].name, CORNER_VIEWS['bottom-front-left'].alpha, CORNER_VIEWS['bottom-front-left'].beta)} 
            />
            <div 
              className={`${styles.vertex} ${styles.vertexBR} ${hoveredId === 'bottom-front-right' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredId('bottom-front-right')} onMouseLeave={() => setHoveredId(null)}
              onClick={() => triggerView(CORNER_VIEWS['bottom-front-right'].name, CORNER_VIEWS['bottom-front-right'].alpha, CORNER_VIEWS['bottom-front-right'].beta)} 
            />
            <div 
              className={`${styles.edge} ${styles.edgeTop} ${hoveredId === 'top-front' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredId('top-front')} onMouseLeave={() => setHoveredId(null)}
              onClick={() => triggerView(EDGE_VIEWS['top-front'].name, EDGE_VIEWS['top-front'].alpha, EDGE_VIEWS['top-front'].beta)} 
            />
            <div 
              className={`${styles.edge} ${styles.edgeBottom} ${hoveredId === 'bottom-front' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredId('bottom-front')} onMouseLeave={() => setHoveredId(null)}
              onClick={() => triggerView(EDGE_VIEWS['bottom-front'].name, EDGE_VIEWS['bottom-front'].alpha, EDGE_VIEWS['bottom-front'].beta)} 
            />
            <div 
              className={`${styles.edge} ${styles.edgeLeft} ${hoveredId === 'front-left' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredId('front-left')} onMouseLeave={() => setHoveredId(null)}
              onClick={() => triggerView(EDGE_VIEWS['front-left'].name, EDGE_VIEWS['front-left'].alpha, EDGE_VIEWS['front-left'].beta)} 
            />
            <div 
              className={`${styles.edge} ${styles.edgeRight} ${hoveredId === 'front-right' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredId('front-right')} onMouseLeave={() => setHoveredId(null)}
              onClick={() => triggerView(EDGE_VIEWS['front-right'].name, EDGE_VIEWS['front-right'].alpha, EDGE_VIEWS['front-right'].beta)} 
            />
            <div className={styles.centerPart} onClick={() => triggerView('FRONT', Math.PI / 2, Math.PI / 2)}>FRONT</div>
          </div>

          {/* BACK FACE */}
          <div className={`${styles.face} ${styles.back}`}>
            <div 
              className={`${styles.vertex} ${styles.vertexTL} ${hoveredId === 'top-back-right' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredId('top-back-right')} onMouseLeave={() => setHoveredId(null)}
              onClick={() => triggerView(CORNER_VIEWS['top-back-right'].name, CORNER_VIEWS['top-back-right'].alpha, CORNER_VIEWS['top-back-right'].beta)} 
            />
            <div 
              className={`${styles.vertex} ${styles.vertexTR} ${hoveredId === 'top-back-left' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredId('top-back-left')} onMouseLeave={() => setHoveredId(null)}
              onClick={() => triggerView(CORNER_VIEWS['top-back-left'].name, CORNER_VIEWS['top-back-left'].alpha, CORNER_VIEWS['top-back-left'].beta)} 
            />
            <div 
              className={`${styles.vertex} ${styles.vertexBL} ${hoveredId === 'bottom-back-right' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredId('bottom-back-right')} onMouseLeave={() => setHoveredId(null)}
              onClick={() => triggerView(CORNER_VIEWS['bottom-back-right'].name, CORNER_VIEWS['bottom-back-right'].alpha, CORNER_VIEWS['bottom-back-right'].beta)} 
            />
            <div 
              className={`${styles.vertex} ${styles.vertexBR} ${hoveredId === 'bottom-back-left' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredId('bottom-back-left')} onMouseLeave={() => setHoveredId(null)}
              onClick={() => triggerView(CORNER_VIEWS['bottom-back-left'].name, CORNER_VIEWS['bottom-back-left'].alpha, CORNER_VIEWS['bottom-back-left'].beta)} 
            />
            <div 
              className={`${styles.edge} ${styles.edgeTop} ${hoveredId === 'top-back' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredId('top-back')} onMouseLeave={() => setHoveredId(null)}
              onClick={() => triggerView(EDGE_VIEWS['top-back'].name, EDGE_VIEWS['top-back'].alpha, EDGE_VIEWS['top-back'].beta)} 
            />
            <div 
              className={`${styles.edge} ${styles.edgeBottom} ${hoveredId === 'bottom-back' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredId('bottom-back')} onMouseLeave={() => setHoveredId(null)}
              onClick={() => triggerView(EDGE_VIEWS['bottom-back'].name, EDGE_VIEWS['bottom-back'].alpha, EDGE_VIEWS['bottom-back'].beta)} 
            />
            <div 
              className={`${styles.edge} ${styles.edgeLeft} ${hoveredId === 'back-right' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredId('back-right')} onMouseLeave={() => setHoveredId(null)}
              onClick={() => triggerView(EDGE_VIEWS['back-right'].name, EDGE_VIEWS['back-right'].alpha, EDGE_VIEWS['back-right'].beta)} 
            />
            <div 
              className={`${styles.edge} ${styles.edgeRight} ${hoveredId === 'back-left' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredId('back-left')} onMouseLeave={() => setHoveredId(null)}
              onClick={() => triggerView(EDGE_VIEWS['back-left'].name, EDGE_VIEWS['back-left'].alpha, EDGE_VIEWS['back-left'].beta)} 
            />
            <div className={styles.centerPart} onClick={() => triggerView('BACK', -Math.PI / 2, Math.PI / 2)}>BACK</div>
          </div>

          {/* RIGHT FACE */}
          <div className={`${styles.face} ${styles.right}`}>
            <div 
              className={`${styles.vertex} ${styles.vertexTL} ${hoveredId === 'top-back-right' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredId('top-back-right')} onMouseLeave={() => setHoveredId(null)}
              onClick={() => triggerView(CORNER_VIEWS['top-back-right'].name, CORNER_VIEWS['top-back-right'].alpha, CORNER_VIEWS['top-back-right'].beta)} 
            />
            <div 
              className={`${styles.vertex} ${styles.vertexTR} ${hoveredId === 'top-front-right' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredId('top-front-right')} onMouseLeave={() => setHoveredId(null)}
              onClick={() => triggerView(CORNER_VIEWS['top-front-right'].name, CORNER_VIEWS['top-front-right'].alpha, CORNER_VIEWS['top-front-right'].beta)} 
            />
            <div 
              className={`${styles.vertex} ${styles.vertexBL} ${hoveredId === 'bottom-back-right' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredId('bottom-back-right')} onMouseLeave={() => setHoveredId(null)}
              onClick={() => triggerView(CORNER_VIEWS['bottom-back-right'].name, CORNER_VIEWS['bottom-back-right'].alpha, CORNER_VIEWS['bottom-back-right'].beta)} 
            />
            <div 
              className={`${styles.vertex} ${styles.vertexBR} ${hoveredId === 'bottom-front-right' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredId('bottom-front-right')} onMouseLeave={() => setHoveredId(null)}
              onClick={() => triggerView(CORNER_VIEWS['bottom-front-right'].name, CORNER_VIEWS['bottom-front-right'].alpha, CORNER_VIEWS['bottom-front-right'].beta)} 
            />
            <div 
              className={`${styles.edge} ${styles.edgeTop} ${hoveredId === 'top-right' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredId('top-right')} onMouseLeave={() => setHoveredId(null)}
              onClick={() => triggerView(EDGE_VIEWS['top-right'].name, EDGE_VIEWS['top-right'].alpha, EDGE_VIEWS['top-right'].beta)} 
            />
            <div 
              className={`${styles.edge} ${styles.edgeBottom} ${hoveredId === 'bottom-right' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredId('bottom-right')} onMouseLeave={() => setHoveredId(null)}
              onClick={() => triggerView(EDGE_VIEWS['bottom-right'].name, EDGE_VIEWS['bottom-right'].alpha, EDGE_VIEWS['bottom-right'].beta)} 
            />
            <div 
              className={`${styles.edge} ${styles.edgeLeft} ${hoveredId === 'back-right' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredId('back-right')} onMouseLeave={() => setHoveredId(null)}
              onClick={() => triggerView(EDGE_VIEWS['back-right'].name, EDGE_VIEWS['back-right'].alpha, EDGE_VIEWS['back-right'].beta)} 
            />
            <div 
              className={`${styles.edge} ${styles.edgeRight} ${hoveredId === 'front-right' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredId('front-right')} onMouseLeave={() => setHoveredId(null)}
              onClick={() => triggerView(EDGE_VIEWS['front-right'].name, EDGE_VIEWS['front-right'].alpha, EDGE_VIEWS['front-right'].beta)} 
            />
            <div className={styles.centerPart} onClick={() => triggerView('RIGHT', 0, Math.PI / 2)}>RIGHT</div>
          </div>

          {/* LEFT FACE */}
          <div className={`${styles.face} ${styles.left}`}>
            <div 
              className={`${styles.vertex} ${styles.vertexTL} ${hoveredId === 'top-front-left' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredId('top-front-left')} onMouseLeave={() => setHoveredId(null)}
              onClick={() => triggerView(CORNER_VIEWS['top-front-left'].name, CORNER_VIEWS['top-front-left'].alpha, CORNER_VIEWS['top-front-left'].beta)} 
            />
            <div 
              className={`${styles.vertex} ${styles.vertexTR} ${hoveredId === 'top-back-left' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredId('top-back-left')} onMouseLeave={() => setHoveredId(null)}
              onClick={() => triggerView(CORNER_VIEWS['top-back-left'].name, CORNER_VIEWS['top-back-left'].alpha, CORNER_VIEWS['top-back-left'].beta)} 
            />
            <div 
              className={`${styles.vertex} ${styles.vertexBL} ${hoveredId === 'bottom-front-left' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredId('bottom-front-left')} onMouseLeave={() => setHoveredId(null)}
              onClick={() => triggerView(CORNER_VIEWS['bottom-front-left'].name, CORNER_VIEWS['bottom-front-left'].alpha, CORNER_VIEWS['bottom-front-left'].beta)} 
            />
            <div 
              className={`${styles.vertex} ${styles.vertexBR} ${hoveredId === 'bottom-back-left' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredId('bottom-back-left')} onMouseLeave={() => setHoveredId(null)}
              onClick={() => triggerView(CORNER_VIEWS['bottom-back-left'].name, CORNER_VIEWS['bottom-back-left'].alpha, CORNER_VIEWS['bottom-back-left'].beta)} 
            />
            <div 
              className={`${styles.edge} ${styles.edgeTop} ${hoveredId === 'top-left' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredId('top-left')} onMouseLeave={() => setHoveredId(null)}
              onClick={() => triggerView(EDGE_VIEWS['top-left'].name, EDGE_VIEWS['top-left'].alpha, EDGE_VIEWS['top-left'].beta)} 
            />
            <div 
              className={`${styles.edge} ${styles.edgeBottom} ${hoveredId === 'bottom-left' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredId('bottom-left')} onMouseLeave={() => setHoveredId(null)}
              onClick={() => triggerView(EDGE_VIEWS['bottom-left'].name, EDGE_VIEWS['bottom-left'].alpha, EDGE_VIEWS['bottom-left'].beta)} 
            />
            <div 
              className={`${styles.edge} ${styles.edgeLeft} ${hoveredId === 'front-left' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredId('front-left')} onMouseLeave={() => setHoveredId(null)}
              onClick={() => triggerView(EDGE_VIEWS['front-left'].name, EDGE_VIEWS['front-left'].alpha, EDGE_VIEWS['front-left'].beta)} 
            />
            <div 
              className={`${styles.edge} ${styles.edgeRight} ${hoveredId === 'back-left' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredId('back-left')} onMouseLeave={() => setHoveredId(null)}
              onClick={() => triggerView(EDGE_VIEWS['back-left'].name, EDGE_VIEWS['back-left'].alpha, EDGE_VIEWS['back-left'].beta)} 
            />
            <div className={styles.centerPart} onClick={() => triggerView('LEFT', Math.PI, Math.PI / 2)}>LEFT</div>
          </div>

          {/* TOP FACE */}
          <div className={`${styles.face} ${styles.top}`}>
            <div 
              className={`${styles.vertex} ${styles.vertexTL} ${hoveredId === 'top-back-left' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredId('top-back-left')} onMouseLeave={() => setHoveredId(null)}
              onClick={() => triggerView(CORNER_VIEWS['top-back-left'].name, CORNER_VIEWS['top-back-left'].alpha, CORNER_VIEWS['top-back-left'].beta)} 
            />
            <div 
              className={`${styles.vertex} ${styles.vertexTR} ${hoveredId === 'top-back-right' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredId('top-back-right')} onMouseLeave={() => setHoveredId(null)}
              onClick={() => triggerView(CORNER_VIEWS['top-back-right'].name, CORNER_VIEWS['top-back-right'].alpha, CORNER_VIEWS['top-back-right'].beta)} 
            />
            <div 
              className={`${styles.vertex} ${styles.vertexBL} ${hoveredId === 'top-front-left' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredId('top-front-left')} onMouseLeave={() => setHoveredId(null)}
              onClick={() => triggerView(CORNER_VIEWS['top-front-left'].name, CORNER_VIEWS['top-front-left'].alpha, CORNER_VIEWS['top-front-left'].beta)} 
            />
            <div 
              className={`${styles.vertex} ${styles.vertexBR} ${hoveredId === 'top-front-right' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredId('top-front-right')} onMouseLeave={() => setHoveredId(null)}
              onClick={() => triggerView(CORNER_VIEWS['top-front-right'].name, CORNER_VIEWS['top-front-right'].alpha, CORNER_VIEWS['top-front-right'].beta)} 
            />
            <div 
              className={`${styles.edge} ${styles.edgeTop} ${hoveredId === 'top-back' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredId('top-back')} onMouseLeave={() => setHoveredId(null)}
              onClick={() => triggerView(EDGE_VIEWS['top-back'].name, EDGE_VIEWS['top-back'].alpha, EDGE_VIEWS['top-back'].beta)} 
            />
            <div 
              className={`${styles.edge} ${styles.edgeBottom} ${hoveredId === 'top-front' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredId('top-front')} onMouseLeave={() => setHoveredId(null)}
              onClick={() => triggerView(EDGE_VIEWS['top-front'].name, EDGE_VIEWS['top-front'].alpha, EDGE_VIEWS['top-front'].beta)} 
            />
            <div 
              className={`${styles.edge} ${styles.edgeLeft} ${hoveredId === 'top-left' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredId('top-left')} onMouseLeave={() => setHoveredId(null)}
              onClick={() => triggerView(EDGE_VIEWS['top-left'].name, EDGE_VIEWS['top-left'].alpha, EDGE_VIEWS['top-left'].beta)} 
            />
            <div 
              className={`${styles.edge} ${styles.edgeRight} ${hoveredId === 'top-right' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredId('top-right')} onMouseLeave={() => setHoveredId(null)}
              onClick={() => triggerView(EDGE_VIEWS['top-right'].name, EDGE_VIEWS['top-right'].alpha, EDGE_VIEWS['top-right'].beta)} 
            />
            <div className={styles.centerPart} onClick={() => triggerView('TOP', Math.PI / 2, 0.01)}>TOP</div>
          </div>

          {/* BOTTOM FACE */}
          <div className={`${styles.face} ${styles.bottom}`}>
            <div 
              className={`${styles.vertex} ${styles.vertexTL} ${hoveredId === 'bottom-front-left' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredId('bottom-front-left')} onMouseLeave={() => setHoveredId(null)}
              onClick={() => triggerView(CORNER_VIEWS['bottom-front-left'].name, CORNER_VIEWS['bottom-front-left'].alpha, CORNER_VIEWS['bottom-front-left'].beta)} 
            />
            <div 
              className={`${styles.vertex} ${styles.vertexTR} ${hoveredId === 'bottom-front-right' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredId('bottom-front-right')} onMouseLeave={() => setHoveredId(null)}
              onClick={() => triggerView(CORNER_VIEWS['bottom-front-right'].name, CORNER_VIEWS['bottom-front-right'].alpha, CORNER_VIEWS['bottom-front-right'].beta)} 
            />
            <div 
              className={`${styles.vertex} ${styles.vertexBL} ${hoveredId === 'bottom-back-left' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredId('bottom-back-left')} onMouseLeave={() => setHoveredId(null)}
              onClick={() => triggerView(CORNER_VIEWS['bottom-back-left'].name, CORNER_VIEWS['bottom-back-left'].alpha, CORNER_VIEWS['bottom-back-left'].beta)} 
            />
            <div 
              className={`${styles.vertex} ${styles.vertexBR} ${hoveredId === 'bottom-back-right' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredId('bottom-back-right')} onMouseLeave={() => setHoveredId(null)}
              onClick={() => triggerView(CORNER_VIEWS['bottom-back-right'].name, CORNER_VIEWS['bottom-back-right'].alpha, CORNER_VIEWS['bottom-back-right'].beta)} 
            />
            <div 
              className={`${styles.edge} ${styles.edgeTop} ${hoveredId === 'bottom-front' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredId('bottom-front')} onMouseLeave={() => setHoveredId(null)}
              onClick={() => triggerView(EDGE_VIEWS['bottom-front'].name, EDGE_VIEWS['bottom-front'].alpha, EDGE_VIEWS['bottom-front'].beta)} 
            />
            <div 
              className={`${styles.edge} ${styles.edgeBottom} ${hoveredId === 'bottom-back' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredId('bottom-back')} onMouseLeave={() => setHoveredId(null)}
              onClick={() => triggerView(EDGE_VIEWS['bottom-back'].name, EDGE_VIEWS['bottom-back'].alpha, EDGE_VIEWS['bottom-back'].beta)} 
            />
            <div 
              className={`${styles.edge} ${styles.edgeLeft} ${hoveredId === 'bottom-left' ? styles.html ? '' : 'bottom-left' : ''}`} 
              onMouseEnter={() => setHoveredId('bottom-left')} onMouseLeave={() => setHoveredId(null)}
              onClick={() => triggerView(EDGE_VIEWS['bottom-left'].name, EDGE_VIEWS['bottom-left'].alpha, EDGE_VIEWS['bottom-left'].beta)} 
            />
            <div 
              className={`${styles.edge} ${styles.edgeRight} ${hoveredId === 'bottom-right' ? styles.highlighted : ''}`} 
              onMouseEnter={() => setHoveredId('bottom-right')} onMouseLeave={() => setHoveredId(null)}
              onClick={() => triggerView(EDGE_VIEWS['bottom-right'].name, EDGE_VIEWS['bottom-right'].alpha, EDGE_VIEWS['bottom-right'].beta)} 
            />
            <div className={styles.centerPart} onClick={() => triggerView('BOTTOM', Math.PI / 2, Math.PI - 0.01)}>BOTTOM</div>
          </div>
        </div>
      </CustomTooltip>
    </div>
  );
};