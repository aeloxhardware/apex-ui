import React, { useState } from 'react';
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import { Header } from "./components/Header";
import { Sidebar } from "./components/Sidebar";
import { Viewport3D } from "./components/Viewport3D";
import { Controls } from "./components/Controls";
import styles from "./App.module.scss";

const queryClient = new QueryClient();

const MainApp = () => {
  const [activeTab, setActiveTab] = useState<'3d-view' | 'settings' | 'developer'>('3d-view');

  const handleTabChange = (tab: 'box' | 'settings' | 'developer') => {
    if (tab === 'box') {
      setActiveTab('3d-view');
    } else {
      setActiveTab(tab);
    }
  };

  return (
    <div className={styles.appContainer}>
      <Header />
      <div className={styles.mainLayout}>
        <Sidebar activeTab={activeTab} onTabChange={handleTabChange} />
        <div className={styles.viewportContainer}>
          <Viewport3D />
          <Controls activeTab={activeTab} />
        </div>
      </div>
    </div>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<MainApp />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;