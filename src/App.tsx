"use client";

import React, { Suspense, lazy } from 'react';
// HashRouter : sous file:// (application de bureau) le chemin de la page n'est pas « / », BrowserRouter ne reconnaitrait aucune route.
import { HashRouter as Router, Routes, Route } from 'react-router-dom';
import { isFlatUi } from '@/utils/interfaceMode';
import { useUiSounds } from '@/hooks/use-ui-sounds';

// Deux interfaces SÉPARÉES, lues une fois au lancement (utils/interfaceMode.ts) : chargées à la demande,
// l'interface classique ne charge donc jamais Index (panneaux de verre, rideaux, framer-motion…), ni l'inverse.
const Index = lazy(() => import('./pages/Index'));
const NotificationStack = lazy(() => import('@/components/NotificationStack').then((m) => ({ default: m.NotificationStack })));
const ClassicApp = lazy(() => import('@/components/classic/ClassicApp'));

function LiquidApp() {
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

function App() {
  return (
    <Suspense fallback={null}>
      {isFlatUi() ? <ClassicApp /> : <LiquidApp />}
    </Suspense>
  );
}

export default App;
