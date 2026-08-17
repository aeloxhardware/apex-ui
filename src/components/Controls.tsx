"use client";

import React from 'react';
import { Sliders, Settings, Code, Layers, Box } from 'lucide-react';

interface ControlsProps {
  activeTab: '3d-view' | 'settings' | 'developer';
}

export const Controls: React.FC<ControlsProps> = ({ activeTab }) => {
  return (
    <div className="absolute top-20 right-4 z-50 w-80 bg-zinc-900/80 backdrop-blur-md border border-zinc-800 rounded-xl p-4 shadow-2xl text-zinc-200">
      <div className="flex items-center justify-between mb-4 pb-2 border-b border-zinc-800">
        <h2 className="font-semibold text-sm flex items-center gap-2">
          {activeTab === '3d-view' && <Box className="w-4 h-4 text-cyan-400" />}
          {activeTab === 'settings' && <Settings className="w-4 h-4 text-cyan-400" />}
          {activeTab === 'developer' && <Code className="w-4 h-4 text-cyan-400" />}
          <span className="capitalize">{activeTab === '3d-view' ? '3D Viewport Controls' : activeTab}</span>
        </h2>
        <span className="text-[10px] bg-cyan-500/10 text-cyan-400 px-2 py-0.5 rounded-full border border-cyan-500/20">Active</span>
      </div>

      <div className="space-y-4 text-xs">
        {activeTab === '3d-view' && (
          <div className="space-y-3">
            <p className="text-zinc-400">Use the left sidebar tools to move, rotate, or inspect slice layers of your 3D models.</p>
            <div className="p-3 bg-zinc-950/60 rounded-lg border border-zinc-800/80 space-y-2">
              <div className="flex justify-between">
                <span className="text-zinc-400">Build Volume</span>
                <span className="font-medium text-zinc-200">Ø250 × 130 mm</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Grid Spacing</span>
                <span className="font-medium text-zinc-200">10.0 mm</span>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="space-y-3">
            <div>
              <label className="text-zinc-400 block mb-1">Print Profile</label>
              <select className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-zinc-200 outline-none focus:border-cyan-500">
                <option>Standard Quality (0.20mm)</option>
                <option>Draft Quality (0.30mm)</option>
                <option>Fine Detail (0.12mm)</option>
              </select>
            </div>
            <div>
              <label className="text-zinc-400 block mb-1">Infill Density</label>
              <input type="range" min="0" max="100" defaultValue="20" className="w-full accent-cyan-400" />
            </div>
          </div>
        )}

        {activeTab === 'developer' && (
          <div className="space-y-3">
            <p className="text-zinc-400">Babylon.js Scene & Shader Debugger</p>
            <div className="bg-zinc-950 p-2.5 rounded font-mono text-[10px] text-cyan-400 border border-zinc-800">
              <div>Engine: WebGL2 active</div>
              <div>Shaders: Custom Boundary Mat Loaded</div>
              <div>FPS: 60 (stable)</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};