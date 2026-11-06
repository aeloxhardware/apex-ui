import { useRef, useState } from 'react';
import type React from 'react';

const MARGIN = 8;
const MIN_THUMB_PX = 32;

/**
 * Barre de défilement personnalisée d'un panneau : position et hauteur de la poignée recalculées au
 * défilement, glisser-déposer de la poignée. `contentRef` se pose sur la zone qui défile.
 */
export function useCustomScrollbar() {
  const contentRef = useRef<HTMLDivElement>(null);
  const startYRef = useRef(0);
  const startScrollTopRef = useRef(0);
  const [thumbHeight, setThumbHeight] = useState(40);
  const [thumbTop, setThumbTop] = useState(8);
  const [hasScroll, setHasScroll] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const handleScroll = () => {
    if (!contentRef.current || isDragging) return;
    const { scrollTop, scrollHeight, clientHeight } = contentRef.current;
    if (scrollHeight <= clientHeight) {
      setHasScroll(false);
      return;
    }
    setHasScroll(true);

    const trackHeight = clientHeight - (MARGIN * 2);
    const calculatedHeight = Math.max(MIN_THUMB_PX, (clientHeight / scrollHeight) * trackHeight);

    const maxScrollTop = scrollHeight - clientHeight;
    const maxThumbTop = trackHeight - calculatedHeight;
    const calculatedTop = maxScrollTop > 0 ? MARGIN + (scrollTop / maxScrollTop) * maxThumbTop : MARGIN;

    setThumbHeight(calculatedHeight);
    setThumbTop(calculatedTop);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    startYRef.current = e.clientY;
    if (contentRef.current) {
      startScrollTopRef.current = contentRef.current.scrollTop;
    }
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    e.preventDefault();
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!contentRef.current) return;
    const deltaY = e.clientY - startYRef.current;
    const { scrollHeight, clientHeight } = contentRef.current;
    const trackHeight = clientHeight - (MARGIN * 2);
    const maxThumbTop = trackHeight - thumbHeight;
    const maxScrollTop = scrollHeight - clientHeight;

    if (maxThumbTop > 0) {
      const scrollRatio = deltaY / maxThumbTop;
      const newScrollTop = Math.max(0, Math.min(maxScrollTop, startScrollTopRef.current + scrollRatio * maxScrollTop));
      contentRef.current.scrollTop = newScrollTop;

      const calculatedTop = MARGIN + (newScrollTop / maxScrollTop) * maxThumbTop;
      setThumbTop(calculatedTop);
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  };

  return { contentRef, thumbHeight, thumbTop, hasScroll, isDragging, handleScroll, handleMouseDown };
}
