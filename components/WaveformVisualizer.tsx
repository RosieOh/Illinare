'use client';

import { useEffect, useRef } from 'react';

export default function WaveformVisualizer({ active }: { active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const timeRef = useRef(0);

  useEffect(() => {
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);

      const bars = 60;
      const barWidth = width / bars;

      for (let i = 0; i < bars; i++) {
        const x = i * barWidth;
        const noise =
          Math.sin(timeRef.current * 3 + i * 0.5) * 0.5 +
          Math.sin(timeRef.current * 7 + i * 0.3) * 0.3 +
          Math.sin(timeRef.current * 1.5 + i * 0.8) * 0.2;
        const barHeight = active
          ? (Math.abs(noise) + 0.1) * height * 0.8
          : (Math.abs(Math.sin(timeRef.current + i * 0.2)) * 0.15 + 0.05) * height;

        const gradient = ctx.createLinearGradient(
          0,
          height / 2 - barHeight / 2,
          0,
          height / 2 + barHeight / 2
        );
        gradient.addColorStop(0, 'rgba(56, 189, 248, 0.85)');
        gradient.addColorStop(0.5, 'rgba(103, 232, 249, 1)');
        gradient.addColorStop(1, 'rgba(56, 189, 248, 0.85)');

        ctx.fillStyle = gradient;
        ctx.shadowColor = '#38bdf8';
        ctx.shadowBlur = active ? 6 : 3;
        ctx.fillRect(x + 1, height / 2 - barHeight / 2, barWidth - 2, barHeight);
      }

      timeRef.current += active ? 0.05 : 0.01;
      if (!reduce) animRef.current = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(animRef.current);
  }, [active]);

  return (
    <canvas
      ref={canvasRef}
      width={300}
      height={60}
      className="w-full h-full"
      role="img"
      aria-label={active ? '음성 활성화 파형' : '음성 대기 파형'}
    />
  );
}
