'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import {
  ChevronLeft, ChevronRight,
  Bot, BarChart3, Shield, Calendar, Brain, Target,
  CircleDot, Lock, Eye, KeyRound, Network, Atom,
  AlertCircle, AlertTriangle, Info, CheckCircle2,
} from 'lucide-react';
import { useGesture } from '@/context/GestureContext';
import type { LucideIcon } from 'lucide-react';

// ─── Slide data — discriminated union ────────────────────────────────
type Slide =
  | {
      id: number;
      type: 'hero';
      icon: LucideIcon;
      title: string;
      subtitle: string;
      body: string;
      stats: { label: string; value: string }[];
    }
  | {
      id: number;
      type: 'bars';
      icon: LucideIcon;
      title: string;
      subtitle: string;
      body: string;
      bars: { label: string; value: number; target: number }[];
    }
  | {
      id: number;
      type: 'list';
      icon: LucideIcon;
      title: string;
      subtitle: string;
      body: string;
      items: { icon: LucideIcon; text: string; status: '활성' | '개발중' }[];
    }
  | {
      id: number;
      type: 'schedule';
      icon: LucideIcon;
      title: string;
      subtitle: string;
      body: string;
      schedule: { day: string; tasks: string[]; highlight: boolean }[];
    }
  | {
      id: number;
      type: 'insights';
      icon: LucideIcon;
      title: string;
      subtitle: string;
      body: string;
      insights: {
        level: 'high' | 'medium' | 'low' | 'info';
        text: string;
      }[];
    }
  | {
      id: number;
      type: 'okr';
      icon: LucideIcon;
      title: string;
      subtitle: string;
      body: string;
      okrs: { objective: string; progress: number; keyResults: string[] }[];
    };

const slides: Slide[] = [
  {
    id: 1,
    type: 'hero',
    icon: Bot,
    title: '일리네어 AI 시스템',
    subtitle: '차세대 통합 인공지능 플랫폼 — v7.3',
    body: '일리네어는 실시간 자연어 처리, 컴퓨터 비전, 예측 분석을 하나의 플랫폼에 통합한 엔터프라이즈 AI 솔루션입니다. 보안, 생산성, 자동화의 새로운 기준을 제시합니다.',
    stats: [
      { label: '처리 속도', value: '2.4 TFLOPS' },
      { label: '응답 시간', value: '< 50ms' },
      { label: '정확도', value: '98.7%' },
      { label: '가동률', value: '99.97%' },
    ],
  },
  {
    id: 2,
    type: 'bars',
    icon: BarChart3,
    title: '분기별 성과 현황',
    subtitle: 'Q1 2024 — KPI 달성률',
    body: '이번 분기 핵심 성과 지표 달성 현황입니다. 전반적으로 목표 대비 양호한 성과를 보이고 있습니다.',
    bars: [
      { label: '신규 사용자 획득', value: 87, target: 100 },
      { label: 'AI 모델 정확도', value: 94, target: 90 },
      { label: '시스템 가동률', value: 99, target: 99 },
      { label: '고객 만족도 (NPS)', value: 72, target: 80 },
      { label: '비용 절감율', value: 63, target: 70 },
    ],
  },
  {
    id: 3,
    type: 'list',
    icon: Shield,
    title: '보안 프로토콜',
    subtitle: '다중 계층 Zero-Trust 보안 아키텍처',
    body: '일리네어는 군사급 암호화 기술과 AI 기반 실시간 위협 탐지 시스템을 탑재하여 데이터와 시스템을 보호합니다.',
    items: [
      { icon: Lock, text: '256-bit AES 엔드-투-엔드 암호화', status: '활성' },
      { icon: Eye, text: '실시간 AI 위협 탐지 및 대응', status: '활성' },
      { icon: KeyRound, text: '다중 인증 시스템 (MFA + 생체인식)', status: '활성' },
      { icon: Network, text: 'Zero-Trust 네트워크 아키텍처', status: '활성' },
      { icon: Atom, text: '양자 내성 암호화 (Post-Quantum)', status: '개발중' },
    ],
  },
  {
    id: 4,
    type: 'schedule',
    icon: Calendar,
    title: '이번 주 팀 일정',
    subtitle: '2024년 3월 4주차 — 주요 이벤트',
    body: '팀 전체 일정 및 중요 마일스톤을 확인하세요.',
    schedule: [
      { day: '월', tasks: ['09:00 전체 스탠드업', '14:00 기획 검토'], highlight: false },
      { day: '화', tasks: ['10:00 AI 모델 발표', '16:00 코드 리뷰'], highlight: false },
      { day: '수', tasks: ['11:00 클라이언트 데모', '15:00 디자인 QA'], highlight: true },
      { day: '목', tasks: ['09:30 투자자 미팅', '17:00 배포 준비'], highlight: false },
      { day: '금', tasks: ['주간 회고', '스프린트 종료'], highlight: false },
    ],
  },
  {
    id: 5,
    type: 'insights',
    icon: Brain,
    title: 'AI 분석 인사이트',
    subtitle: '일리네어 시스템이 감지한 주요 현황',
    body: 'AI 모니터링 시스템이 실시간으로 분석한 결과입니다.',
    insights: [
      { level: 'high', text: '네트워크 트래픽 평균 대비 23% 급증 감지 — 조사 필요' },
      { level: 'medium', text: '메모리 사용률 78% — 최적화 권장' },
      { level: 'low', text: '백업 시스템 마지막 검증 7일 경과' },
      { level: 'info', text: '보안 패치 v3.2.1 적용 완료 — 취약점 해소' },
      { level: 'info', text: 'AI 추론 성능 14% 향상 달성' },
    ],
  },
  {
    id: 6,
    type: 'okr',
    icon: Target,
    title: '이번 달 OKR 현황',
    subtitle: '목표 및 핵심 결과 — 3월 달성률',
    body: '조직 목표와 핵심 결과물의 진행 상황을 확인하세요.',
    okrs: [
      {
        objective: '사용자 경험 혁신',
        progress: 76,
        keyResults: ['앱 로딩 속도 2초 → 0.8초', 'NPS 점수 80+ 달성', 'A/B 테스트 5회 완료'],
      },
      {
        objective: '시스템 안정성 강화',
        progress: 94,
        keyResults: ['가동률 99.9% 유지', '장애 대응 시간 50% 단축', '자동 복구 시스템 구축'],
      },
      {
        objective: '핵심 기능 출시',
        progress: 58,
        keyResults: ['AI 채팅 고도화', '제스처 인식 시스템', '실시간 분석 대시보드'],
      },
    ],
  },
];

// ─── Slide header ────────────────────────────────────────────────────
function SlideHeader({ slide }: { slide: Slide }) {
  const Icon = slide.icon;
  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-md bg-[var(--color-accent-soft)] border border-[color:var(--color-accent-ring)] flex items-center justify-center">
          <Icon size={20} className="text-accent" aria-hidden="true" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-primary">{slide.title}</h2>
          <p className="text-muted text-sm">{slide.subtitle}</p>
        </div>
      </div>
      <p className="text-secondary text-sm">{slide.body}</p>
      <div className="w-full h-px mt-4 bg-[var(--color-border)]" />
    </div>
  );
}

// ─── Slide renderers ────────────────────────────────────────────────
function HeroSlide({ slide }: { slide: Extract<Slide, { type: 'hero' }> }) {
  const Icon = slide.icon;
  return (
    <div className="flex flex-col h-full p-10 justify-between">
      <div>
        <div className="w-16 h-16 rounded-lg bg-[var(--color-accent-soft)] border border-[color:var(--color-accent-ring)] flex items-center justify-center mb-4">
          <Icon size={32} className="text-accent" aria-hidden="true" />
        </div>
        <h1 className="text-[40px] font-semibold mb-2 text-primary text-glow">
          {slide.title}
        </h1>
        <p className="text-muted tracking-wider text-sm mb-6">{slide.subtitle}</p>
        <p className="text-secondary leading-relaxed max-w-2xl">{slide.body}</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {slide.stats.map((s) => (
          <div key={s.label} className="surface rounded-md p-4 text-center">
            <div className="text-xl font-mono font-medium mb-1 text-primary tabular-nums">
              {s.value}
            </div>
            <div className="text-xs text-muted uppercase tracking-wider">{s.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BarsSlide({ slide }: { slide: Extract<Slide, { type: 'bars' }> }) {
  return (
    <div className="flex flex-col h-full p-10">
      <SlideHeader slide={slide} />
      <div className="flex-1 space-y-5 mt-6 overflow-y-auto">
        {slide.bars.map((b, i) => {
          const onTrack = b.value >= b.target;
          return (
            <div key={b.label}>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-primary">{b.label}</span>
                <span
                  className={`font-mono tabular-nums ${
                    onTrack ? 'text-[var(--color-success)]' : 'text-secondary'
                  }`}
                >
                  {b.value}% / 목표 {b.target}%
                </span>
              </div>
              <div className="h-2.5 bg-[var(--color-surface-2)] rounded-full overflow-hidden relative">
                <div
                  className="absolute top-0 bottom-0 w-px bg-[var(--color-text-secondary)]/40 z-10"
                  style={{ left: `${b.target}%` }}
                  aria-hidden="true"
                />
                <motion.div
                  className="h-full rounded-full"
                  style={{
                    backgroundColor: onTrack ? 'var(--color-success)' : 'var(--color-accent)',
                  }}
                  initial={{ width: 0 }}
                  animate={{ width: `${b.value}%` }}
                  transition={{ duration: 1, delay: i * 0.1, ease: 'easeOut' }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ListSlide({ slide }: { slide: Extract<Slide, { type: 'list' }> }) {
  return (
    <div className="flex flex-col h-full p-10">
      <SlideHeader slide={slide} />
      <div className="flex-1 space-y-3 mt-6 overflow-y-auto">
        {slide.items.map((item, i) => {
          const ItemIcon = item.icon;
          const isActive = item.status === '활성';
          return (
            <motion.div
              key={item.text}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.08 }}
              className="flex items-center gap-4 p-4 rounded-md surface"
            >
              <ItemIcon
                size={20}
                className={isActive ? 'text-accent' : 'text-[var(--color-warning)]'}
                aria-hidden="true"
              />
              <span className="flex-1 text-primary text-sm">{item.text}</span>
              <span
                className={`text-xs px-2 py-1 rounded-full border font-mono ${
                  isActive
                    ? 'border-[var(--color-success)]/40 text-[var(--color-success)]'
                    : 'border-[var(--color-warning)]/40 text-[var(--color-warning)]'
                }`}
              >
                {item.status}
              </span>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

function ScheduleSlide({ slide }: { slide: Extract<Slide, { type: 'schedule' }> }) {
  return (
    <div className="flex flex-col h-full p-10">
      <SlideHeader slide={slide} />
      <div className="flex-1 grid grid-cols-1 md:grid-cols-5 gap-3 mt-6">
        {slide.schedule.map((day, i) => (
          <motion.div
            key={day.day}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
            className={`p-3 rounded-md border flex flex-col gap-2 ${
              day.highlight
                ? 'border-[color:var(--color-accent-ring)] bg-[var(--color-accent-soft)]/40'
                : 'border-[var(--color-border)] bg-[var(--color-surface-2)]'
            }`}
          >
            <div
              className={`text-center font-medium text-sm ${
                day.highlight ? 'text-accent' : 'text-secondary'
              }`}
            >
              {day.day}
            </div>
            <div className="space-y-1.5">
              {day.tasks.map((t) => (
                <div
                  key={t}
                  className="text-xs text-secondary p-1.5 rounded bg-[var(--color-surface-1)] leading-tight"
                >
                  {t}
                </div>
              ))}
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

const INSIGHT_META: Record<
  Extract<Slide, { type: 'insights' }>['insights'][number]['level'],
  { icon: LucideIcon; color: string }
> = {
  high: { icon: AlertCircle, color: 'var(--color-danger)' },
  medium: { icon: AlertTriangle, color: 'var(--color-warning)' },
  low: { icon: Info, color: 'var(--color-info)' },
  info: { icon: CheckCircle2, color: 'var(--color-success)' },
};

function InsightsSlide({ slide }: { slide: Extract<Slide, { type: 'insights' }> }) {
  return (
    <div className="flex flex-col h-full p-10">
      <SlideHeader slide={slide} />
      <div className="flex-1 space-y-3 mt-6 overflow-y-auto">
        {slide.insights.map((item, i) => {
          const meta = INSIGHT_META[item.level];
          const ItemIcon = meta.icon;
          return (
            <motion.div
              key={item.text}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.08 }}
              className="flex items-start gap-3 p-4 rounded-md surface"
            >
              <ItemIcon size={18} style={{ color: meta.color }} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
              <p className="text-primary text-sm leading-relaxed">{item.text}</p>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

function OkrSlide({ slide }: { slide: Extract<Slide, { type: 'okr' }> }) {
  return (
    <div className="flex flex-col h-full p-10">
      <SlideHeader slide={slide} />
      <div className="flex-1 space-y-5 mt-6 overflow-y-auto">
        {slide.okrs.map((okr, i) => (
          <motion.div
            key={okr.objective}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.12 }}
            className="p-5 rounded-md surface"
          >
            <div className="flex justify-between items-center mb-3">
              <span className="font-medium text-primary">{okr.objective}</span>
              <span className="text-lg font-mono font-medium text-accent tabular-nums">
                {okr.progress}%
              </span>
            </div>
            <div className="h-2 bg-[var(--color-surface-2)] rounded-full overflow-hidden mb-3">
              <motion.div
                className="h-full rounded-full bg-[var(--color-accent)]"
                initial={{ width: 0 }}
                animate={{ width: `${okr.progress}%` }}
                transition={{ duration: 1, delay: i * 0.12 + 0.2 }}
              />
            </div>
            <div className="flex gap-2 flex-wrap">
              {okr.keyResults.map((kr) => (
                <span
                  key={kr}
                  className="text-xs text-muted px-2 py-1 rounded-full border border-[var(--color-border)]"
                >
                  {kr}
                </span>
              ))}
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// 타입 좁히기 — as any 제거
function renderSlide(slide: Slide) {
  switch (slide.type) {
    case 'hero':
      return <HeroSlide slide={slide} />;
    case 'bars':
      return <BarsSlide slide={slide} />;
    case 'list':
      return <ListSlide slide={slide} />;
    case 'schedule':
      return <ScheduleSlide slide={slide} />;
    case 'insights':
      return <InsightsSlide slide={slide} />;
    case 'okr':
      return <OkrSlide slide={slide} />;
  }
}

// ─── Main viewer ────────────────────────────────────────────────────
export default function SlideViewer() {
  const [current, setCurrent] = useState(0);
  const [dir, setDir] = useState(0);
  const { lastSwipe } = useGesture();
  const reduce = useReducedMotion();

  const goTo = useCallback((idx: number, direction: number) => {
    if (idx < 0 || idx >= slides.length) return;
    setDir(direction);
    setCurrent(idx);
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') goTo(current - 1, -1);
      else if (e.key === 'ArrowRight') goTo(current + 1, 1);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [current, goTo]);

  useEffect(() => {
    if (!lastSwipe) return;
    if (lastSwipe.direction === 'left') goTo(current + 1, 1);
    else goTo(current - 1, -1);
  }, [lastSwipe, current, goTo]);

  const slide = slides[current];

  return (
    <div className="h-full flex flex-col p-4 gap-3" role="region" aria-label="프레젠테이션">
      {/* Hint bar */}
      <div className="flex items-center justify-between px-4 py-2 surface rounded-md flex-shrink-0">
        <div className="flex items-center gap-3 text-xs text-muted">
          <CircleDot size={11} className="text-accent" aria-hidden="true" />
          <span>← 이전 / 다음 →</span>
          <span className="text-[var(--color-border-strong)]">|</span>
          <span>제스처: ✌ 스와이프</span>
        </div>
        <span
          className="text-xs font-mono text-secondary tabular-nums"
          aria-label={`${current + 1}번 / ${slides.length}번 중`}
        >
          {current + 1} / {slides.length}
        </span>
      </div>

      {/* Slide stage — 1뷰당 1 강조 */}
      <div className="flex-1 relative overflow-hidden surface-accent rounded-xl">
        <AnimatePresence mode="wait" custom={dir}>
          <motion.div
            key={current}
            custom={dir}
            variants={{
              enter: (d: number) => ({ x: reduce ? 0 : d > 0 ? '50%' : '-50%', opacity: 0 }),
              center: { x: 0, opacity: 1 },
              exit: (d: number) => ({ x: reduce ? 0 : d > 0 ? '-50%' : '50%', opacity: 0 }),
            }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: reduce ? 0 : 0.3, ease: [0.4, 0, 0.2, 1] }}
            className="absolute inset-0"
          >
            {renderSlide(slide)}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Navigation */}
      <div className="flex items-center gap-4 flex-shrink-0">
        <button
          onClick={() => goTo(current - 1, -1)}
          disabled={current === 0}
          aria-label="이전 슬라이드"
          className="p-2.5 rounded-md border border-[var(--color-border)] text-secondary disabled:opacity-30 hover:text-primary hover:bg-[var(--color-surface-2)] transition-colors"
        >
          <ChevronLeft size={18} aria-hidden="true" />
        </button>

        <div
          className="flex-1 flex gap-2 justify-center items-center"
          role="tablist"
          aria-label="슬라이드 인디케이터"
        >
          {slides.map((s, i) => {
            const active = i === current;
            return (
              <button
                key={s.id}
                role="tab"
                aria-selected={active}
                aria-label={`${i + 1}번 슬라이드`}
                onClick={() => goTo(i, i > current ? 1 : -1)}
                className="transition-all duration-200 rounded-full"
                style={{
                  width: active ? 24 : 8,
                  height: 8,
                  backgroundColor: active ? 'var(--color-accent)' : 'var(--color-border-strong)',
                }}
              />
            );
          })}
        </div>

        <button
          onClick={() => goTo(current + 1, 1)}
          disabled={current === slides.length - 1}
          aria-label="다음 슬라이드"
          className="p-2.5 rounded-md border border-[var(--color-border)] text-secondary disabled:opacity-30 hover:text-primary hover:bg-[var(--color-surface-2)] transition-colors"
        >
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
