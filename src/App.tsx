"use client";

import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Index from './pages/Index';
import { Toaster } from '@/components/ui/sonner';

function App() {
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