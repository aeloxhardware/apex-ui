"use client";

import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Index from './pages/Index';
import { NotificationStack } from '@/components/NotificationStack';
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
          sans lui, ces appels ne s'affichaient nulle part. Pile de notifications permanentes
          (aucune ne disparaît seule, fermeture par croix uniquement), empilées avec un effet de
          dépassement (peek) et cycle à la molette — cf. NotificationStack.tsx/.module.scss pour
          le détail du style verre dépoli et de l'animation. */}
      <NotificationStack />
    </Router>
  );
}

export default App;
