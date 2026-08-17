"use client";

import React, { useState } from 'react';
import { Header } from '@/components/Header';
import { Sidebar } from '@/components/Sidebar';
import { Viewport3D } from '@/components/Viewport3D';
import { Box, Layers, Activity } from 'lucide-react';

const Index = () => {
  const [activeTab, setActiveTab] = useState<'3d-view' | 'settings' | 'developer'>('3d-view');
  const [selectedTool, setSelectedTool] = useState('move');
  const [modelName, setModelName] = useState<string | null>("Benchy_v3.stl");

  React.useEffect(() => {
    const handleMeshSelected = (e: any) => {
      if (e.detail?.name) {
        setModelName(e.detail.name);
      }
    };
    window.addEventListener('apex-mesh-selected', handleMeshSelected);
    return () => window.removeEventListener('apex-mesh-selected', handleMeshSelected);
  }, []);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-background select-none">
      <Header />

      <div className="flex flex-1 overflow-hidden relative">
        <Sidebar 
          activeTab={activeTab} 
          onTabChange={setActiveTab} 
          selectedTool={selectedTool}
          onSelectTool={setSelectedTool}
        />

        <main className="flex-1 flex flex-col relative overflow-hidden bg-zinc-950">
          <div className="flex-1 w-full h-full">
            <Viewport3D />
          </div>

          {/* Bottom status / stats overlay */}
          <div className="absolute bottom-4 left-4 right-4 z-10 flex items-center justify-between pointer-events-none">
            <div className="bg-zinc-900/90 backdrop-blur border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-300 flex items-center space-x-4 pointer-events-auto shadow-lg">
              <span className="flex items-center"><Box className="w-3.5 h-3.5 mr-1.5 text-blue-400" /> {modelName || "Aucun modèle"}</span>
              <span className="text-zinc-600">|</span>
              <span>Dimensions: 60.0 x 31.0 x 48.0 mm</span>
              <span className="text-zinc-600">|</span>
              <span className="text-emerald-400 font-medium">Prêt pour le découpage</span>
            </div>

            <div className="bg-zinc-900/90 backdrop-blur border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-300 flex items-center space-x-3 pointer-events-auto shadow-lg">
              <Activity className="w-3.5 h-3.5 text-primary" />
              <span>Temps estimé : 2h 14m</span>
              <span className="text-zinc-600">|</span>
              <span>Filament : 14.2g (4.78m)</span>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default Index;