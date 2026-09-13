"use client";

import React, { useState } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { FileSidebar } from '@/components/FileSidebar';
import { SliceSidebar } from '@/components/SliceSidebar';
import { CategoriesSidebar } from '@/components/CategoriesSidebar';
import { PrinterConfigSidebar } from '@/components/PrinterConfigSidebar';
import { AxisSidebar } from '@/components/AxisSidebar';
import { TopRightMenu } from '@/components/TopRightMenu';
import { ModelStatusBox } from '@/components/ModelStatusBox';
import { ModelHoverTooltip } from '@/components/ModelHoverTooltip';
import { TextureEditorModal } from '@/components/TextureEditorModal';
import { SliceModal } from '@/components/SliceModal';
import { SlicingProgressModal } from '@/components/SlicingProgressModal';
import { ViewCube } from '@/components/ViewCube';
import { Viewport3D } from '@/components/Viewport3D';
import { Box } from 'lucide-react';
import { showSuccess } from '@/utils/toast';

interface ModelStatus {
  name: string;
  dimensions: { x: number; y: number; z: number } | null;
}

const Index = () => {
  const [activeTab, setActiveTab] = useState<'3d-view' | 'settings' | 'developer'>('3d-view');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [isPrinterConfigOpen, setIsPrinterConfigOpen] = useState(false);
  const [selectedPrinter, setSelectedPrinter] = useState('Prusa MK4');
  const [selectedFilament, setSelectedFilament] = useState('PLA Premium (eSUN / Prusament)');
  const [isSliceModalOpen, setIsSliceModalOpen] = useState(false);
  const [isSlicingProgressOpen, setIsSlicingProgressOpen] = useState(false);
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null);

  React.useEffect(() => {
    const handleModelSelected = (event: CustomEvent<{
      name: string | null;
      dimensions?: { x: number; y: number; z: number };
    }>) => {
      if (!event.detail?.name) {
        setModelStatus(null);
        return;
      }

      setModelStatus({
        name: event.detail.name,
        dimensions: event.detail.dimensions ?? null,
      });
    };

    const handleModelImported = (event: CustomEvent<File>) => {
      if (event.detail?.name) {
        setModelStatus({ name: event.detail.name, dimensions: null });
      }
    };

    window.addEventListener('apex-mesh-selected', handleModelSelected as EventListener);
    window.addEventListener('apex-import-model', handleModelImported as EventListener);

    return () => {
      window.removeEventListener('apex-mesh-selected', handleModelSelected as EventListener);
      window.removeEventListener('apex-import-model', handleModelImported as EventListener);
    };
  }, []);

  const handleSlice = () => {
    window.dispatchEvent(new CustomEvent('apex-request-slice-models'));
    setIsSliceModalOpen(true);
  };

  const handleConfirmSlice = () => {
    window.dispatchEvent(new CustomEvent('apex-slice-all-models'));
    setIsSliceModalOpen(false);
    setIsSlicingProgressOpen(true);
  };

  const handleSlicingFinished = () => {
    setIsSlicingProgressOpen(false);
    showSuccess("Slicing plate completed successfully!");
  };

  const handleOpenModel = () => {
    showSuccess("Select an STL or GLB file to add a model.");
  };

  const handleSaveProject = () => {
    showSuccess("Project saved successfully.");
  };

  return (
    <div 
      className="flex flex-col h-screen w-screen overflow-hidden select-none relative bg-cover bg-center"
      style={{ backgroundImage: `url('/background.jpg')` }}
    >
      <FileSidebar 
        onOpenModel={handleOpenModel}
        onSaveProject={handleSaveProject}
        onOpenSettings={() => setActiveTab('settings')}
        onOpenPrinterConfig={() => {
          setIsPrinterConfigOpen(!isPrinterConfigOpen);
          setActiveCategory(null);
        }}
        selectedPrinter={selectedPrinter}
        selectedFilament={selectedFilament}
      />

      <ModelStatusBox />
      <ModelHoverTooltip />
      <TextureEditorModal />
      <SliceModal
        isOpen={isSliceModalOpen}
        onClose={() => setIsSliceModalOpen(false)}
        onConfirm={handleConfirmSlice}
      />
      <SlicingProgressModal
        isOpen={isSlicingProgressOpen}
        onClose={() => setIsSlicingProgressOpen(false)}
        onFinished={handleSlicingFinished}
      />

      <Sidebar 
        activeTab={activeTab} 
        onTabChange={(tab) => {
          setActiveTab(tab === 'box' ? '3d-view' : tab);
          setIsPrinterConfigOpen(false);
        }}
        onOpenModel={handleOpenModel}
      />

      <TopRightMenu />
      <AxisSidebar />
      <ViewCube />

      <CategoriesSidebar
        activeCategory={activeCategory} 
        onSelectCategory={(cat) => {
          setActiveCategory(cat);
          if (cat) setIsPrinterConfigOpen(false);
        }} 
      />

      <PrinterConfigSidebar
        isOpen={isPrinterConfigOpen}
        onClose={() => setIsPrinterConfigOpen(false)}
        selectedPrinter={selectedPrinter}
        onSelectPrinter={setSelectedPrinter}
        selectedFilament={selectedFilament}
        onSelectFilament={setSelectedFilament}
      />

      <SliceSidebar onSlice={handleSlice} />

      <main className="flex-1 flex flex-col relative overflow-hidden z-10 bg-transparent">
        <div className="flex-1 w-full h-full">
          <Viewport3D />
        </div>

        {/* Bottom status / stats overlay */}
        <div className="absolute bottom-4 left-4 right-24 z-20 flex items-center justify-start pointer-events-none">
          <div className="bg-[rgba(10,15,26,0.25)] backdrop-blur-[4px] -webkit-backdrop-blur-[4px] border-none rounded-lg px-3 py-2 text-xs text-zinc-300 flex items-center space-x-4 pointer-events-auto shadow-[0_8px_32px_0_rgba(0,0,0,0.4),0_2px_8px_0_rgba(0,0,0,0.3)]">
            {modelStatus ? (
              <>
                <span className="flex items-center"><Box className="w-3.5 h-3.5 mr-1.5 text-blue-400" /> {modelStatus.name}</span>
                {modelStatus.dimensions && (
                  <>
                    <span className="text-zinc-600">|</span>
                    <span>Dimensions: {modelStatus.dimensions.x.toFixed(1)} x {modelStatus.dimensions.z.toFixed(1)} x {modelStatus.dimensions.y.toFixed(1)} mm</span>
                  </>
                )}
                <span className="text-zinc-600">|</span>
                <span className="text-emerald-400 font-medium">Ready to slice</span>
              </>
            ) : (
              <span className="text-zinc-400">Aucun modèle sur le plateau</span>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default Index;