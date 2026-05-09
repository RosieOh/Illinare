'use client';

import { useState, useEffect, Suspense, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import {
  LayoutDashboard, Presentation, Bot, Activity,
  Shield, Cpu, Zap, Eye, Radar, Brain, Gauge,
} from 'lucide-react';
import { GestureProvider } from '@/context/GestureContext';
import { speakKorean } from '@/utils/speech';
import { useSystemStats } from '@/utils/useSystemStats';
import Dashboard from '@/components/Dashboard';
import SlideViewer from '@/components/SlideViewer';
import ChatInterface from '@/components/ChatInterface';
import SystemStats from '@/components/SystemStats';
import WaveformVisualizer from '@/components/WaveformVisualizer';

const HolographicScene = dynamic(() => import('@/components/HolographicScene'), { ssr: false });
const RadarDisplay = dynamic(() => import('@/components/RadarDisplay'), { ssr: false });
const HandGestureCamera = dynamic(() => import('@/components/HandGestureCamera'), { ssr: false });
const GestureCursor = dynamic(() => import('@/components/GestureCursor'), { ssr: false });

type PageId = 'dashboard' | 'slides' | 'ai' | 'system';

const NAV: Array<{
  id: PageId;
  icon: typeof LayoutDashboard;
  label: string;
}> = [
  { id: 'dashboard', icon: LayoutDashboard, label: '대시보드' },
  { id: 'slides', icon: Presentation, label: '프레젠테이션' },
  { id: 'ai', icon: Bot, label: 'AI 어시스턴트' },
  { id: 'system', icon: Activity, label: '시스템' },
];

const BOOT_LINES = [
  '> 일리네어 v7.3.0 초기화 중...',
  '> 신경망 모듈 로딩...',
  '> 홀로그램 프로젝터 보정...',
  '> 보안 채널 암호화...',
  '> 컴퓨터 비전 시스템 활성화...',
  '> 시스템 진단... 정상',
  '> 일리네어 온라인.',
];

// ─── Boot Sequence ───────────────────────────────────────────────────
function BootSequence({ onComplete }: { onComplete: () => void }) {
  const [lines, setLines] = useState<string[]>([]);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (reduce) {
      setLines(BOOT_LINES);
      const t = setTimeout(onComplete, 200);
      return () => clearTimeout(t);
    }
    let i = 0;
    const t = setInterval(() => {
      if (i < BOOT_LINES.length) {
        setLines((p) => [...p, BOOT_LINES[i++]]);
      } else {
        clearInterval(t);
        setTimeout(onComplete, 500);
      }
    }, 280);
    return () => clearInterval(t);
  }, [onComplete, reduce]);

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-surface-base)]"
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5 }}
      role="status"
      aria-live="polite"
      aria-label="시스템 부팅 중"
    >
      <div className="w-full max-w-xl px-8">
        <motion.div
          className="text-[40px] font-semibold text-center mb-10 text-primary tracking-[0.3em] text-glow"
          animate={reduce ? undefined : { opacity: [0.55, 1, 0.55] }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          일리네어
        </motion.div>
        <div className="space-y-2 font-mono">
          <AnimatePresence>
            {lines.map((line, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                className={`text-sm ${
                  i === lines.length - 1 ? 'text-accent' : 'text-muted'
                }`}
              >
                {line}
              </motion.div>
            ))}
          </AnimatePresence>
          <span className="text-accent inline-block cursor-blink" aria-hidden="true">▌</span>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Status Badge ────────────────────────────────────────────────────
function Badge({
  icon: Icon,
  label,
  value,
  tone = 'neutral',
}: {
  icon: typeof Shield;
  label: string;
  value: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
}) {
  const toneClass = {
    neutral: 'text-secondary',
    success: 'text-[var(--color-success)]',
    warning: 'text-[var(--color-warning)]',
    danger: 'text-[var(--color-danger)]',
  }[tone];
  return (
    <div
      className="flex items-center gap-2 px-3 h-9 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-1)]"
      role="status"
      aria-label={`${label} ${value}`}
    >
      <Icon size={14} className={toneClass} aria-hidden="true" />
      <span className="text-xs text-muted uppercase tracking-wider">{label}</span>
      <span className={`text-sm font-medium font-mono ${toneClass}`}>{value}</span>
    </div>
  );
}

// ─── AI View ─────────────────────────────────────────────────────────
function AIView({
  active,
  aiActive,
  setAiActive,
}: {
  active: boolean;
  aiActive: boolean;
  setAiActive: (v: boolean) => void;
}) {
  return (
    <div className="h-full flex gap-4 p-4 min-h-0">
      {/* 3D Scene — 강조 영역 (1뷰당 1 강조) */}
      <div className="flex-1 relative rounded-xl overflow-hidden surface-accent">
        <div className="absolute inset-0">
          <Suspense fallback={null}>
            <HolographicScene active={active && aiActive} visible={active} />
          </Suspense>
        </div>

        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10">
          <div className="text-[11px] text-muted tracking-[0.25em] uppercase px-3 py-1 border border-[var(--color-border)] rounded-full bg-[var(--color-surface-base)]/60 backdrop-blur-sm">
            홀로그램 코어
          </div>
        </div>

        <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${
              aiActive ? 'bg-[var(--color-success)] status-pulse' : 'bg-[var(--color-text-disabled)]'
            }`}
            aria-hidden="true"
          />
          <span className="text-xs text-secondary">{aiActive ? '처리중' : '대기중'}</span>
        </div>

        {/* Floating data labels — 색은 muted, 값만 secondary로 위계 */}
        {[
          { label: '신경망', value: '7 레이어', x: '8%', y: '18%' },
          { label: '처리 속도', value: '2.4 TFLOPS', x: '68%', y: '14%' },
          { label: '가동률', value: '99.97%', x: '72%', y: '72%' },
        ].map((item) => (
          <div
            key={item.label}
            className="absolute text-xs pointer-events-none"
            style={{ left: item.x, top: item.y }}
          >
            <div className="text-muted tracking-widest uppercase text-[10px]">{item.label}</div>
            <div className="text-secondary font-mono text-sm">{item.value}</div>
            <div className="w-10 h-px bg-[var(--color-border-strong)] mt-1" />
          </div>
        ))}

        <div className="absolute bottom-4 left-4 right-4 h-10">
          <WaveformVisualizer active={active && aiActive} />
        </div>
      </div>

      {/* Chat panel */}
      <div className="w-[340px] flex-shrink-0">
        <div className="h-full surface rounded-xl flex flex-col overflow-hidden">
          <ChatInterface onActivity={setAiActive} />
        </div>
      </div>
    </div>
  );
}

// ─── System View ─────────────────────────────────────────────────────
function SystemView({ active }: { active: boolean }) {
  return (
    <div className="h-full flex gap-4 p-4 min-h-0">
      <div className="w-72 flex flex-col gap-4">
        <div className="surface rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Radar size={14} className="text-accent" aria-hidden="true" />
            <span className="text-xs text-muted tracking-widest uppercase">레이더 스캔</span>
          </div>
          <div className="w-full aspect-square">
            <RadarDisplay visible={active} />
          </div>
        </div>
        <div className="flex-1 flex flex-col gap-2">
          {[
            { icon: Brain, label: '신경망', value: '활성화', tone: 'success' as const },
            { icon: Eye, label: '비전 시스템', value: '스캔중', tone: 'neutral' as const },
            { icon: Shield, label: '방어 시스템', value: '무장완료', tone: 'neutral' as const },
            { icon: Zap, label: '에너지', value: '91%', tone: 'success' as const },
          ].map((item) => {
            const tone = {
              success: 'text-[var(--color-success)]',
              neutral: 'text-accent',
            }[item.tone];
            return (
              <div
                key={item.label}
                className="surface rounded-md p-3 flex items-center gap-3"
              >
                <item.icon size={16} className={tone} aria-hidden="true" />
                <div className="flex-1">
                  <div className="text-[11px] text-muted uppercase tracking-wider">{item.label}</div>
                  <div className={`text-sm font-medium ${tone}`}>{item.value}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex-1 min-w-0">
        <div className="surface rounded-xl p-4 h-full">
          <div className="flex items-center gap-2 mb-4">
            <Gauge size={14} className="text-accent" aria-hidden="true" />
            <span className="text-xs text-muted tracking-widest uppercase">시스템 진단 현황</span>
          </div>
          <SystemStats />
        </div>
      </div>
    </div>
  );
}

// ─── Main App ────────────────────────────────────────────────────────
function AppContent() {
  const [page, setPage] = useState<PageId>('dashboard');
  const [booted, setBooted] = useState(false);
  const [aiActive, setAiActive] = useState(false);
  const [alertLevel, setAlertLevel] = useState<'정상' | '주의' | '모니터링'>('정상');
  const systemStats = useSystemStats();

  const handleBootComplete = useCallback(() => {
    setBooted(true);
    setTimeout(
      () => speakKorean('안녕하세요, 보스. 일리네어 시스템 온라인입니다. 무엇을 도와드릴까요?'),
      800
    );
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      const pool: Array<'정상' | '주의' | '모니터링'> = ['정상', '정상', '정상', '주의', '모니터링'];
      setAlertLevel(pool[Math.floor(Math.random() * pool.length)]);
    }, 9000);
    return () => clearInterval(id);
  }, []);

  const cpu = systemStats.find((s) => s.label === 'CPU 사용률')?.value ?? 0;
  const mem = systemStats.find((s) => s.label === '메모리')?.value ?? 0;
  const disk = systemStats.find((s) => s.label === '디스크')?.value ?? 0;
  const alertTone: 'success' | 'warning' = alertLevel === '정상' ? 'success' : 'warning';

  return (
    <>
      <AnimatePresence>{!booted && <BootSequence onComplete={handleBootComplete} />}</AnimatePresence>

      <GestureCursor />

      <motion.div
        className="fixed inset-0 overflow-hidden bg-[var(--color-surface-base)]"
        initial={{ opacity: 0 }}
        animate={{ opacity: booted ? 1 : 0 }}
        transition={{ duration: 0.6 }}
        aria-hidden={!booted}
      >
        {/* Subtle ambient — 깊이감만, 강조 X */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(900px 600px at 50% 0%, rgba(56,189,248,0.06), transparent 70%)',
          }}
          aria-hidden="true"
        />

        <div className="relative z-10 h-full flex flex-col">
          {/* ── Top Bar ── */}
          <header
            className="flex items-center px-4 py-3 border-b border-[var(--color-border)] gap-4 flex-shrink-0"
            role="banner"
          >
            <div className="flex items-center gap-3">
              <div className="text-[15px] font-semibold tracking-[0.25em] text-primary">일리네어</div>
              <div className="hidden md:block text-[11px] text-muted tracking-widest uppercase">
                Illionaire AI System
              </div>
              <span
                className="hidden md:inline-flex items-center gap-1 px-2 h-5 rounded-full bg-[var(--color-accent-soft)] text-[10px] text-accent uppercase tracking-widest border border-[color:var(--color-accent-ring)]"
                title="실제 시스템과 연동된 라이브 모드"
              >
                Live
              </span>
            </div>

            {/* Nav tabs */}
            <nav className="flex gap-1 ml-4" aria-label="주 메뉴">
              {NAV.map((item) => {
                const isActive = page === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setPage(item.id)}
                    aria-current={isActive ? 'page' : undefined}
                    className={`flex items-center gap-2 h-9 px-3 rounded-md text-sm transition-colors ${
                      isActive
                        ? 'bg-[var(--color-accent-soft)] text-primary border border-[color:var(--color-accent-ring)]'
                        : 'text-secondary hover:text-primary hover:bg-[var(--color-surface-2)] border border-transparent'
                    }`}
                  >
                    <item.icon size={15} aria-hidden="true" />
                    <span className="hidden sm:inline">{item.label}</span>
                  </button>
                );
              })}
            </nav>

            {/* Status badges */}
            <div className="ml-auto flex items-center gap-2 flex-wrap justify-end">
              <Badge icon={Shield} label="보안" value={alertLevel} tone={alertTone} />
              <Badge icon={Cpu} label="CPU" value={`${cpu.toFixed(0)}%`} tone={cpu > 80 ? 'warning' : 'neutral'} />
              <Badge icon={Activity} label="MEM" value={`${mem.toFixed(0)}%`} tone={mem > 90 ? 'warning' : 'neutral'} />
              <Badge icon={Zap} label="DISK" value={`${disk.toFixed(0)}%`} tone={disk > 90 ? 'warning' : 'neutral'} />
            </div>
          </header>

          {/* ── Main Content — visibility 토글로 상태 보존 ── */}
          <main className="flex-1 min-h-0 relative">
            <ViewSlot id="dashboard" current={page}><Dashboard /></ViewSlot>
            <ViewSlot id="slides" current={page}><SlideViewer /></ViewSlot>
            <ViewSlot id="ai" current={page}>
              <AIView active={page === 'ai'} aiActive={aiActive} setAiActive={setAiActive} />
            </ViewSlot>
            <ViewSlot id="system" current={page}>
              <SystemView active={page === 'system'} />
            </ViewSlot>
          </main>

          {/* ── Bottom Bar ── */}
          <footer
            className="flex items-center justify-between px-5 py-2 border-t border-[var(--color-border)] text-[11px] text-muted tracking-widest flex-shrink-0"
            role="contentinfo"
          >
            <span>일리네어 AI — 첨단 인공지능 부문</span>
            <span>ILLIONAIRE © 2024</span>
            <span>기밀 등급 5</span>
          </footer>
        </div>
      </motion.div>

      <HandGestureCamera />
    </>
  );
}

function ViewSlot({
  id,
  current,
  children,
}: {
  id: PageId;
  current: PageId;
  children: React.ReactNode;
}) {
  const isActive = id === current;
  return (
    <div
      className="absolute inset-0 transition-opacity duration-200"
      style={{
        opacity: isActive ? 1 : 0,
        pointerEvents: isActive ? 'auto' : 'none',
        visibility: isActive ? 'visible' : 'hidden',
      }}
      aria-hidden={!isActive}
    >
      {children}
    </div>
  );
}

export default function App() {
  return (
    <GestureProvider>
      <AppContent />
    </GestureProvider>
  );
}
