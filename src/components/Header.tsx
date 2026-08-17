"use client";

import React from 'react';
import { Button } from '@/components/ui/button';
import { Play, Settings, FolderOpen, Save, HelpCircle, Cpu } from 'lucide-react';

export const Header = () => {
  return (
    <header className="h-14 border-b border-border bg-card px-4 flex items-center justify-between z-10">
      <div className="flex items-center space-x-3">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-bold shadow-sm">
            <Cpu className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-bold text-sm leading-none">Apex Slicer UI</h1>
            <span className="text-[10px] text-muted-foreground">v1.0.0 Professional</span>
          </div>
        </div>

        <div className="h-4 w-[1px] bg-border mx-2" />

        <div className="flex items-center space-x-1">
          <Button variant="ghost" size="sm" className="h-8 px-2.5 text-xs">
            <FolderOpen className="w-3.5 h-3.5 mr-1.5" />
            Open Model
          </Button>
          <Button variant="ghost" size="sm" className="h-8 px-2.5 text-xs">
            <Save className="w-3.5 h-3.5 mr-1.5" />
            Save Project
          </Button>
        </div>
      </div>

      <div className="flex items-center space-x-2">
        <Button variant="outline" size="sm" className="h-8 text-xs">
          <Settings className="w-3.5 h-3.5 mr-1.5" />
          Printer: Prusa MK4
        </Button>
        <Button variant="outline" size="sm" className="h-8 text-xs">
          Filament: PLA (0.20mm)
        </Button>
        <Button size="sm" className="h-8 text-xs bg-primary hover:bg-primary/90">
          <Play className="w-3.5 h-3.5 mr-1.5 fill-current" />
          Slice Plate
        </Button>
      </div>
    </header>
  );
};