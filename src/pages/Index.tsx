"use client";

import React, { useState } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { FileSidebar } from '@/components/FileSidebar';
import { Viewport3D } from '@/components/Viewport3D';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Box, Layers, Activity } from 'lucide-react';
import { showSuccess } from '@/utils/toast';

const Index = () => {
  const [activeTab, setActiveTab] = useState<'3d-view' | 'settings' | 'developer'>('3d-view');

  const handleSlice = () => {
    showSuccess("Slicing plate completed successfully!");
  };

  const handleOpenModel = () => {
    showSuccess("Select an STL file or click import to add a model.");
  };

  const handleSaveProject = () => {
    showSuccess("Project saved successfully.");
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-background select-none relative">
      <FileSidebar 
        onOpenModel={handleOpenModel}
        onSaveProject={handleSaveProject}
        onOpenSettings={() => setActiveTab('settings')}
      />

      <Sidebar 
        activeTab={activeTab} 
        onTabChange={(tab) => setActiveTab(tab === 'box' ? '3d-view' : tab)}
        onSlice={handleSlice}
        onOpenModel={handleOpenModel}
      />

      <main className="flex-1 flex flex-col relative overflow-hidden bg-zinc-950">
        <div className="flex-1 w-full h-full">
          <Viewport3D />
        </div>

        {/* Bottom status / stats overlay */}
        <div className="absolute bottom-4 left-4 right-4 z-10 flex items-center justify-between pointer-events-none">
          <div className="bg-zinc-900/90 backdrop-blur border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-300 flex items-center space-x-4 pointer-events-auto shadow-lg">
            <span className="flex items-center"><Box className="w-3.5 h-3.5 mr-1.5 text-blue-400" /> Benchy_v3.stl</span>
            <span className="text-zinc-600">|</span>
            <span>Dimensions: 60.0 x 31.0 x 48.0 mm</span>
            <span className="text-zinc-600">|</span>
            <span className="text-emerald-400 font-medium">Ready to slice</span>
          </div>

          <div className="bg-zinc-900/90 backdrop-blur border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-300 flex items-center space-x-3 pointer-events-auto shadow-lg">
            <Activity className="w-3.5 h-3.5 text-primary" />
            <span>Est. Time: 2h 14m</span>
            <span className="text-zinc-600">|</span>
            <span>Filament: 14.2g (4.78m)</span>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Index;