'use client';

import React, { createContext, useContext, useState, useCallback, useRef, ReactNode } from 'react';

export type GestureType = 'none' | 'point' | 'pinch' | 'open' | 'fist' | 'peace';

export interface CursorPos { x: number; y: number }

interface SwipeEvent { direction: 'left' | 'right'; timestamp: number }

interface GestureContextValue {
  gesture: GestureType;
  cursorPos: CursorPos | null;
  isCameraActive: boolean;
  isModelLoaded: boolean;
  lastSwipe: SwipeEvent | null;
  toggleCamera: () => void;
  setGesture: (g: GestureType) => void;
  setCursorPos: (p: CursorPos | null) => void;
  setModelLoaded: (v: boolean) => void;
  emitSwipe: (dir: 'left' | 'right') => void;
}

const GestureContext = createContext<GestureContextValue | null>(null);

export function GestureProvider({ children }: { children: ReactNode }) {
  const [gesture, setGesture] = useState<GestureType>('none');
  const [cursorPos, setCursorPos] = useState<CursorPos | null>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const [lastSwipe, setLastSwipe] = useState<SwipeEvent | null>(null);

  const toggleCamera = useCallback(() => setIsCameraActive(v => !v), []);
  const emitSwipe = useCallback((direction: 'left' | 'right') => {
    setLastSwipe({ direction, timestamp: Date.now() });
  }, []);

  return (
    <GestureContext.Provider value={{
      gesture, cursorPos, isCameraActive, isModelLoaded, lastSwipe,
      toggleCamera,
      setGesture,
      setCursorPos,
      setModelLoaded: setIsModelLoaded,
      emitSwipe,
    }}>
      {children}
    </GestureContext.Provider>
  );
}

export function useGesture() {
  const ctx = useContext(GestureContext);
  if (!ctx) throw new Error('useGesture must be used within GestureProvider');
  return ctx;
}
