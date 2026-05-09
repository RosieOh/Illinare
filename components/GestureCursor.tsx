'use client';

import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGesture } from '@/context/GestureContext';

export default function GestureCursor() {
  const { cursorPos, gesture, isCameraActive } = useGesture();
  const lastPinchRef = useRef(false);

  // Simulate click on pinch
  useEffect(() => {
    if (!cursorPos) return;
    const isPinching = gesture === 'pinch';

    if (isPinching && !lastPinchRef.current) {
      // Fire click at cursor position
      const el = document.elementFromPoint(cursorPos.x, cursorPos.y);
      if (el && el !== document.body) {
        (el as HTMLElement).dispatchEvent(
          new MouseEvent('click', { bubbles: true, clientX: cursorPos.x, clientY: cursorPos.y })
        );
      }
    }
    lastPinchRef.current = isPinching;
  }, [gesture, cursorPos]);

  if (!isCameraActive || !cursorPos) return null;

  const isPinching = gesture === 'pinch';
  const isPeace = gesture === 'peace';
  const isPointing = gesture === 'point';

  const outerColor = isPinching ? '#34d399' : isPeace ? '#fbbf24' : '#38bdf8';
  const outerSize = isPinching ? 36 : 24;

  return (
    <div className="fixed inset-0 z-[60] pointer-events-none">
      <AnimatePresence>
        {cursorPos && (
          <motion.div
            key="cursor"
            className="absolute"
            style={{ left: cursorPos.x, top: cursorPos.y, transform: 'translate(-50%, -50%)' }}
            animate={{ scale: isPinching ? [1, 1.4, 1] : 1 }}
            transition={{ duration: 0.2 }}
          >
            {/* Outer ring */}
            <motion.div
              className="absolute rounded-full border-2"
              style={{
                width: outerSize,
                height: outerSize,
                borderColor: outerColor,
                boxShadow: `0 0 ${isPinching ? 20 : 8}px ${outerColor}`,
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
              }}
              animate={{ rotate: isPointing ? 360 : 0 }}
              transition={{ duration: 2, repeat: isPointing ? Infinity : 0, ease: 'linear' }}
            />

            {/* Ripple on pinch */}
            {isPinching && (
              <motion.div
                className="absolute rounded-full border"
                style={{ borderColor: outerColor, top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}
                initial={{ width: outerSize, height: outerSize, opacity: 0.8 }}
                animate={{ width: outerSize * 2.5, height: outerSize * 2.5, opacity: 0 }}
                transition={{ duration: 0.4 }}
              />
            )}

            {/* Inner dot */}
            <div
              className="absolute rounded-full"
              style={{
                width: 6, height: 6,
                backgroundColor: outerColor,
                boxShadow: `0 0 6px ${outerColor}`,
                top: '50%', left: '50%',
                transform: 'translate(-50%, -50%)',
              }}
            />

            {/* Gesture label */}
            {isPeace && (
              <div
                className="absolute top-6 left-1/2 text-xs font-mono whitespace-nowrap px-2 py-0.5 rounded"
                style={{
                  color: outerColor,
                  background: 'rgba(0,0,0,0.7)',
                  border: `1px solid ${outerColor}40`,
                  transform: 'translateX(-50%)',
                }}
              >
                ← 슬라이드 →
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
