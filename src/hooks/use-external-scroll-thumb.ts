import { useRef, useState } from 'react';

/**
 * Curseur de défilement externe (hors du conteneur scrollable, cf. `.externalScrollThumb` dans
 * CategoriesSidebar.module.scss) : même comportement que la scrollbar native, mais dessiné à côté
 * du panneau plutôt que dedans, glissable à la souris. Extrait de la logique dupliquée deux fois
 * dans CategoriesSidebar.tsx (menu de catégorie + popup de motifs de remplissage) pour être
 * réutilisé ailleurs (cf. GCodeLineTypeLegend.tsx) sans la retripliquer.
 *
 * @param contentRef Conteneur scrollable dont ce hook lit `scrollTop`/`scrollHeight`/`clientHeight`.
 */
export function useExternalScrollThumb(contentRef: React.RefObject<HTMLElement>) {
  const [thumbHeight, setThumbHeight] = useState(40);
  const [thumbTop, setThumbTop] = useState(8);
  const [hasScroll, setHasScroll] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const startYRef = useRef(0);
  const startScrollTopRef = useRef(0);
  // Lu depuis les écouteurs `document` posés pendant le glisser (fermant sur `thumbHeight` par
  // valeur au moment de `handleMouseDown` sinon) : toujours la valeur la plus récente.
  const thumbHeightRef = useRef(thumbHeight);
  thumbHeightRef.current = thumbHeight;
  const isDraggingRef = useRef(false);

  const MARGIN = 8;

  const handleScroll = () => {
    if (!contentRef.current || isDraggingRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = contentRef.current;
    if (scrollHeight <= clientHeight) {
      setHasScroll(false);
      return;
    }
    setHasScroll(true);

    const trackHeight = clientHeight - MARGIN * 2;
    const calculatedHeight = Math.max(32, (clientHeight / scrollHeight) * trackHeight);

    const maxScrollTop = scrollHeight - clientHeight;
    const maxThumbTop = trackHeight - calculatedHeight;
    const calculatedTop = maxScrollTop > 0 ? MARGIN + (scrollTop / maxScrollTop) * maxThumbTop : MARGIN;

    setThumbHeight(calculatedHeight);
    setThumbTop(calculatedTop);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!contentRef.current) return;
    const deltaY = e.clientY - startYRef.current;
    const { scrollHeight, clientHeight } = contentRef.current;
    const trackHeight = clientHeight - MARGIN * 2;
    const maxThumbTop = trackHeight - thumbHeightRef.current;
    const maxScrollTop = scrollHeight - clientHeight;

    if (maxThumbTop > 0) {
      const scrollRatio = deltaY / maxThumbTop;
      const newScrollTop = Math.max(0, Math.min(maxScrollTop, startScrollTopRef.current + scrollRatio * maxScrollTop));
      contentRef.current.scrollTop = newScrollTop;
      setThumbTop(MARGIN + (newScrollTop / maxScrollTop) * maxThumbTop);
    }
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
    setIsDragging(false);
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    isDraggingRef.current = true;
    setIsDragging(true);
    startYRef.current = e.clientY;
    if (contentRef.current) startScrollTopRef.current = contentRef.current.scrollTop;
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    e.preventDefault();
  };

  return { thumbHeight, thumbTop, hasScroll, isDragging, handleScroll, handleMouseDown };
}
