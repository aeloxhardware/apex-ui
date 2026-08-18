import React, { useEffect, useRef, useState } from 'react';

interface ViewcubeProps {
  cameraRef?: React.RefObject<any>;
}

export const Viewcube: React.FC<ViewcubeProps> = ({ cameraRef }) => {
  const [activeFace, setActiveFace] = useState<string | null>(null);

  const handleFaceClick = (face: string) => {
    setActiveFace(face);
    // You can dispatch custom events or trigger camera orientation if cameraRef or global event is available
    window.dispatchEvent(new CustomEvent('apex-viewcube-click', { detail: { face } }));
    
    setTimeout(() => {
      setActiveFace(null);
    }, 300);
  };

  return (
    <div className="absolute bottom-6 left-6 z-30 pointer-events-auto flex flex-col items-center select-none group">
      <div className="relative w-28 h-28 perspective-[400px] cursor-pointer">
        {/* 3D-styled interactive viewcube container */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="relative w-20 h-20 transform-gpu transition-transform duration-300 hover:scale-105"
               style={{ transformStyle: 'preserve-3d', transform: 'rotateX(-25deg) rotateY(-45deg)' }}>
            
            {/* Front */}
            <div 
              onClick={() => handleFaceClick('front')}
              className={`absolute inset-0 bg-[#121926]/90 border border-blue-500/40 backdrop-blur-sm flex items-center justify-center text-[10px] font-bold text-blue-300 shadow-md transition-colors hover:bg-blue-600/40 hover:text-white ${activeFace === 'front' ? 'bg-blue-500 text-white' : ''}`}
              style={{ transform: 'translateZ(40px)' }}
            >
              AVANT
            </div>

            {/* Back */}
            <div 
              onClick={() => handleFaceClick('back')}
              className={`absolute inset-0 bg-[#121926]/90 border border-blue-500/40 backdrop-blur-sm flex items-center justify-center text-[10px] font-bold text-blue-300 shadow-md transition-colors hover:bg-blue-600/40 hover:text-white ${activeFace === 'back' ? 'bg-blue-500 text-white' : ''}`}
              style={{ transform: 'rotateY(180deg) translateZ(40px)' }}
            >
              ARRIÈRE
            </div>

            {/* Right */}
            <div 
              onClick={() => handleFaceClick('right')}
              className={`absolute inset-0 bg-[#121926]/90 border border-blue-500/40 backdrop-blur-sm flex items-center justify-center text-[10px] font-bold text-blue-300 shadow-md transition-colors hover:bg-blue-600/40 hover:text-white ${activeFace === 'right' ? 'bg-blue-500 text-white' : ''}`}
              style={{ transform: 'rotateY(90deg) translateZ(40px)' }}
            >
              DROITE
            </div>

            {/* Left */}
            <div 
              onClick={() => handleFaceClick('left')}
              className={`absolute inset-0 bg-[#121926]/90 border border-blue-500/40 backdrop-blur-sm flex items-center justify-center text-[10px] font-bold text-blue-300 shadow-md transition-colors hover:bg-blue-600/40 hover:text-white ${activeFace === 'left' ? 'bg-blue-500 text-white' : ''}`}
              style={{ transform: 'rotateY(-90deg) translateZ(40px)' }}
            >
              GAUCHE
            </div>

            {/* Top */}
            <div 
              onClick={() => handleFaceClick('top')}
              className={`absolute inset-0 bg-[#121926]/90 border border-blue-500/40 backdrop-blur-sm flex items-center justify-center text-[10px] font-bold text-blue-300 shadow-md transition-colors hover:bg-blue-600/40 hover:text-white ${activeFace === 'top' ? 'bg-blue-500 text-white' : ''}`}
              style={{ transform: 'rotateX(90deg) translateZ(40px)' }}
            >
              DESSUS
            </div>

            {/* Bottom */}
            <div 
              onClick={() => handleFaceClick('bottom')}
              className={`absolute inset-0 bg-[#121926]/90 border border-blue-500/40 backdrop-blur-sm flex items-center justify-center text-[10px] font-bold text-blue-300 shadow-md transition-colors hover:bg-blue-600/40 hover:text-white ${activeFace === 'bottom' ? 'bg-blue-500 text-white' : ''}`}
              style={{ transform: 'rotateX(-90deg) translateZ(40px)' }}
            >
              DESSOUS
            </div>
          </div>
        </div>
      </div>
      <div className="text-[10px] text-zinc-400 font-medium tracking-wider bg-black/40 px-2 py-0.5 rounded-full border border-white/10 backdrop-blur-md mt-1 shadow-sm">
        VIEWCUBE
      </div>
    </div>
  );
};