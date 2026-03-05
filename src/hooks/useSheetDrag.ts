import { useEffect, useState, useCallback } from 'react';

interface SheetDragState {
  sheetHeight: number;
  startDrag: (e: React.MouseEvent | React.TouchEvent) => void;
}

export default function useSheetDrag(isOpen: boolean, initialHeight = 460): SheetDragState {
  const [sheetHeight, setSheetHeight] = useState(initialHeight);
  const [isDragging, setIsDragging] = useState(false);
  const [startY, setStartY] = useState(0);
  const [startHeight, setStartHeight] = useState(0);

  useEffect(() => {
    if (!isOpen || !isDragging) return;
    const onMove = (e: MouseEvent | TouchEvent) => {
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
      setSheetHeight(Math.min(Math.max(340, startHeight + (startY - clientY)), window.innerHeight * 0.92));
    };
    const onEnd = () => setIsDragging(false);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);
    document.addEventListener('touchmove', onMove);
    document.addEventListener('touchend', onEnd);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onEnd);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
    };
  }, [isOpen, isDragging, startY, startHeight]);

  const startDrag = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    setIsDragging(true);
    setStartY('touches' in e ? e.touches[0].clientY : e.clientY);
    setStartHeight(sheetHeight);
  }, [sheetHeight]);

  return { sheetHeight, startDrag };
}
