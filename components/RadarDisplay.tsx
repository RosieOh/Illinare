'use client';

import { useEffect, useRef } from 'react';

export default function RadarDisplay({ visible = true }: { visible?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const angleRef = useRef(0);
  const blipsRef = useRef<{ angle: number; dist: number; alpha: number }[]>([
    { angle: 0.8, dist: 0.4, alpha: 1 },
    { angle: 2.1, dist: 0.7, alpha: 0.8 },
    { angle: 4.5, dist: 0.3, alpha: 0.6 },
    { angle: 5.8, dist: 0.6, alpha: 0.9 },
    { angle: 3.2, dist: 0.85, alpha: 0.7 },
  ]);

  useEffect(() => {
    if (!visible) {
      cancelAnimationFrame(animRef.current);
      return;
    }
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      const { width, height } = canvas;
      const cx = width / 2;
      const cy = height / 2;
      const r = Math.min(cx, cy) - 8;

      ctx.clearRect(0, 0, width, height);

      ctx.fillStyle = 'rgba(12, 20, 36, 0.85)';
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();

      // Grid circles
      for (let i = 1; i <= 4; i++) {
        ctx.beginPath();
        ctx.arc(cx, cy, (r / 4) * i, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(56, 189, 248, ${0.08 + i * 0.04})`;
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }

      // Cross lines
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.12)';
      ctx.lineWidth = 0.5;
      for (let a = 0; a < Math.PI; a += Math.PI / 6) {
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        ctx.lineTo(cx - Math.cos(a) * r, cy - Math.sin(a) * r);
        ctx.stroke();
      }

      // Sweep
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angleRef.current);

      for (let i = 0; i < 60; i++) {
        const a = -(i / 60) * (Math.PI / 2);
        const opacity = (1 - i / 60) * 0.3;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, r, a - 0.05, a + 0.05);
        ctx.closePath();
        ctx.fillStyle = `rgba(56, 189, 248, ${opacity})`;
        ctx.fill();
      }

      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(r, 0);
      ctx.strokeStyle = 'rgba(103, 232, 249, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.shadowColor = '#67e8f9';
      ctx.shadowBlur = 6;
      ctx.stroke();

      ctx.restore();

      // Blips
      blipsRef.current.forEach((blip) => {
        const diff =
          (((angleRef.current - blip.angle) % (Math.PI * 2)) + Math.PI * 2) %
          (Math.PI * 2);
        if (diff < 0.2) blip.alpha = 1;
        else blip.alpha = Math.max(0, blip.alpha - 0.003);

        if (blip.alpha > 0) {
          const bx = cx + Math.cos(blip.angle) * blip.dist * r;
          const by = cy + Math.sin(blip.angle) * blip.dist * r;
          ctx.beginPath();
          ctx.arc(bx, by, 3, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(52, 211, 153, ${blip.alpha})`;
          ctx.shadowColor = '#34d399';
          ctx.shadowBlur = 10;
          ctx.fill();
        }
      });

      // Border
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
      ctx.lineWidth = 1;
      ctx.shadowColor = '#38bdf8';
      ctx.shadowBlur = 6;
      ctx.stroke();
      ctx.shadowBlur = 0;

      angleRef.current += reduce ? 0 : 0.02;
      if (!reduce) animRef.current = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(animRef.current);
  }, [visible]);

  return (
    <canvas
      ref={canvasRef}
      width={160}
      height={160}
      className="w-full h-full"
      role="img"
      aria-label="레이더 스캔 시각화"
    />
  );
}
