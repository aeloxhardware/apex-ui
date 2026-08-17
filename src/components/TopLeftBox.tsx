import React from 'react';
import styles from './TopLeftBox.module.scss';

interface TopLeftBoxProps {
  title?: string;
  children?: React.ReactNode;
}

export const TopLeftBox: React.FC<TopLeftBoxProps> = ({ title = "Apex Slicer", children }) => {
  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <div className={styles.title}>{title}</div>
      </div>
      {children && (
        <div className={styles.content}>
          {children}
        </div>
      )}
    </div>
  );
};