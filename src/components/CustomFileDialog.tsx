import React, { useState } from 'react';
import clsx from 'clsx';
import { Folder, FileText, HardDrive, Download, X } from 'lucide-react';
import styles from './CustomFileDialog.module.scss';

interface CustomFileDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectFile: (fileName: string) => void;
}

export const CustomFileDialog: React.FC<CustomFileDialogProps> = ({ isOpen, onClose, onSelectFile }) => {
  const [selectedFolder, setSelectedFolder] = useState('telechargements');
  const [selectedFile, setSelectedFile] = useState('Benchy_v3.stl');

  if (!isOpen) return null;

  const mockFiles = [
    { name: 'Benchy_v3.stl', type: 'stl' },
    { name: 'calibration_cube.stl', type: 'stl' },
    { name: 'polaroid_spectra.stl', type: 'stl' },
    { name: 'phone_stand.stl', type: 'stl' },
    { name: 'gear_bearing.stl', type: 'stl' },
    { name: 'Dossier_Projets', type: 'folder' }
  ];

  return (
    <div className={styles.overlay}>
      <div className={styles.window}>
        <div className={styles.header}>
          <div className={styles.titleBar}>
            <Folder size={16} className="text-cyan-400" />
            <span>Explorateur Apex - Sélection de modèle 3D (.stl)</span>
          </div>
          <button className={styles.closeBtn} onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className={styles.body}>
          <div className={styles.sidebar}>
            <button 
              className={clsx(styles.sidebarItem, { [styles.active]: selectedFolder === 'bureau' })}
              onClick={() => setSelectedFolder('bureau')}
            >
              <HardDrive size={15} /> Bureau
            </button>
            <button 
              className={clsx(styles.sidebarItem, { [styles.active]: selectedFolder === 'telechargements' })}
              onClick={() => setSelectedFolder('telechargements')}
            >
              <Download size={15} /> Téléchargements
            </button>
            <button 
              className={clsx(styles.sidebarItem, { [styles.active]: selectedFolder === 'documents' })}
              onClick={() => setSelectedFolder('documents')}
            >
              <FileText size={15} /> Documents
            </button>
          </div>

          <div className={styles.contentArea}>
            <div className={styles.sectionHeader}>Aujourd'hui</div>
            <div className={styles.fileGrid}>
              {mockFiles.map((file, idx) => (
                <div 
                  key={idx}
                  className={styles.fileCard}
                  onClick={() => {
                    setSelectedFile(file.name);
                    if (file.type !== 'folder') {
                      onSelectFile(file.name);
                      onClose();
                    }
                  }}
                >
                  <div className={styles.fileIcon}>
                    {file.type === 'folder' ? '📁' : '🧊'}
                  </div>
                  <span className={styles.fileName}>{file.name}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className={styles.footer}>
          <div className={styles.footerInputGroup}>
            <label>Nom du fichier :</label>
            <input 
              type="text" 
              value={selectedFile} 
              onChange={(e) => setSelectedFile(e.target.value)} 
            />
          </div>
          <div className={styles.footerButtons}>
            <button className={styles.btnPrimary} onClick={() => {
              onSelectFile(selectedFile);
              onClose();
            }}>
              Ouvrir
            </button>
            <button className={styles.btnSecondary} onClick={onClose}>
              Annuler
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};