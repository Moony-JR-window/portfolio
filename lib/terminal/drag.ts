import { useCallback, useEffect, useRef, useState } from 'react';
import type { Position } from './types';

/**
 * Reusable free-drag hook for floating windows.
 * Supports mouse + touch, clamps to viewport, and returns
 * the current position plus a startDrag handler.
 */
export function useDraggable(initial: Position = { x: 400, y: 90 }) {
  const [pos, setPos] = useState<Position>(initial);
  const elRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const offsetRef = useRef({ x: 0, y: 0 });

  const clamp = useCallback((clientX: number, clientY: number): Position => {
    const width = elRef.current?.offsetWidth ?? 520;
    const height = elRef.current?.offsetHeight ?? 360;
    const margin = 8;
    return {
      x: Math.max(
        margin,
        Math.min(clientX - offsetRef.current.x, window.innerWidth - width - margin),
      ),
      y: Math.max(
        margin,
        Math.min(clientY - offsetRef.current.y, window.innerHeight - height - margin),
      ),
    };
  }, []);

  const move = useCallback(
    (clientX: number, clientY: number) => {
      if (draggingRef.current) setPos(clamp(clientX, clientY));
    },
    [clamp],
  );

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => move(e.clientX, e.clientY);
    const onTouchMove = (e: TouchEvent) => {
      if (draggingRef.current) {
        e.preventDefault();
        move(e.touches[0].clientX, e.touches[0].clientY);
      }
    };
    const onUp = () => {
      draggingRef.current = false;
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onUp);
    };
  }, [move]);

  const startDrag = useCallback((clientX: number, clientY: number) => {
    const el = elRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    offsetRef.current = { x: clientX - rect.left, y: clientY - rect.top };
    setPos({ x: rect.left, y: rect.top });
    draggingRef.current = true;
  }, []);

  return { pos, setPos, elRef, startDrag };
}