"use client";

import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Index from './pages/Index';
import { Toaster } from '@/components/ui/sonner';
import { useUiSounds } from '@/hooks/use-ui-sounds';

function App() {
  // Sons de survol/clic sur les éléments interactifs de toute l'interface
  // (voir src/hooks/use-ui-sounds.ts) - monté une seule fois ici.
  useUiSounds();

  return (
    <Router>
      <Routes>
        <Route path="/" element={<Index />} />
      </Routes>
      {/* Point de rendu de tous les messages de src/utils/toast.ts (showSuccess, showWarning…) :
          sans lui, ces appels ne s'affichaient nulle part. Thème forcé : l'interface est sombre
          et aucun ThemeProvider (next-themes) n'est monté. */}
      <Toaster theme="dark" position="bottom-center" />
    </Router>
  );
}

export default App;