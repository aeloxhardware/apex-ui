"use client";

import React, { useState } from 'react';
import { Header } from '@/components/Header';
import { Sidebar } from '@/components/Sidebar';
import { Viewport3D } from '@/components/Viewport3D';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Box, Layers, Sliders, History, Activity } from 'lucide-react';

const Index = () => {
  const [activeTab, setActiveTab] = useState<'prepare' | 'preview'>('prepare');
  const [selectedTool, setSelectedTool] = useState('move');

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-background select-none">
      <Header />

      <div className="flex flex-1 overflow-hidden relative">
        <Sidebar selectedTool={selectedTool} onSelectTool={setSelectedTool} />

        <main className="flex-1 flex flex-col relative overflow-hidden bg-zinc-950">
          {/* Top floating bar over viewport */}
          <div className="absolute top-4 left-4 z-10 flex items-center bg-zinc-900/80 backdrop-blur border border-zinc-800 rounded-lg p-1 shadow-lg">
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-auto">
              <TabsList className="bg-transparent h-8 p-0 space-x-1">
                <TabsTrigger 
                  value="prepare" 
                  className="text-xs h-7 px-3 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-md"
                >
                  <Box className="w-3.5 h-3.5 mr-1.5" />
                  Prepare
                </TabsTrigger>
                <TabsTrigger 
                  value="preview" 
                  className="text-xs h-7 px-3 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-md"
                >
                  <Layers className="w-3.5 h-3.5 mr-1.5" />
                  Preview
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

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
    </div>
  );
};

export default Index;