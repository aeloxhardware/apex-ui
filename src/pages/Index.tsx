import React, { useState } from 'react';
import { Sidebar } from '../components/Sidebar';
import { Viewport3D } from '../components/Viewport3D';
import { TopRightMenu } from '../components/TopRightMenu';
import { TopLeftBox } from '../components/TopLeftBox';

export default function Index() {
  const [activeTab, setActiveTab] = useState<'3d-view' | 'settings' | 'developer'>('3d-view');
  const [selectedModelName, setSelectedModelName] = useState<string | null>(null);

  React.useEffect(() => {
    const handleMeshSelected = (e: CustomEvent<{ name: string | null }>) => {
      setSelectedModelName(e.detail.name);
    };

    window.addEventListener('apex-mesh-selected', handleMeshSelected as EventListener);
    return () => {
      window.removeEventListener('apex-mesh-selected', handleMeshSelected as EventListener);
    };
  }, []);

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden', backgroundColor: '#060911' }}>
      <Sidebar activeTab={activeTab} onTabChange={(tab) => setActiveTab(tab === 'box' ? '3d-view' : tab)} />
      <TopLeftBox title={selectedModelName || "Plateau d'impression"} />
      <TopRightMenu />
      
      <div style={{ width: '100%', height: '100%' }}>
        {activeTab === '3d-view' && <Viewport3D />}
        {activeTab === 'settings' && (
          <div style={{ padding: '40px 100px', color: '#fff', fontFamily: 'sans-serif' }}>
            <h1 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '20px', color: '#00f0ff' }}>Paramètres de l'imprimante</h1>
            <p style={{ color: 'rgba(255,255,255,0.7)' }}>Configuration des profils d'impression, températures et vitesses.</p>
          </div>
        )}
        {activeTab === 'developer' && (
          <div style={{ padding: '40px 100px', color: '#fff', fontFamily: 'sans-serif' }}>
            <h1 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '20px', color: '#00f0ff' }}>Console Développeur</h1>
            <p style={{ color: 'rgba(255,255,255,0.7)' }}>Flux G-code et journaux de diagnostic en temps réel.</p>
          </div>
        )}
      </div>
    </div>
  );
}