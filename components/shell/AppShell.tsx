'use client';

import { useEffect, useRef, useState, type ComponentType } from 'react';
import { RefreshCw, ServerOff } from 'lucide-react';
import { ViewActiveContext } from '@/utils/useNow';
import { Button, Material } from '@/components/glass';
import { useApp, VIEW_IDS, type ViewId } from '@/context/AppContext';
import { useMissions } from '@/context/MissionsContext';
import ActivityView from '@/components/views/ActivityView';
import DecksView from '@/components/views/DecksView';
import MissionsView from '@/components/views/MissionsView';
import PlannerView from '@/components/views/PlannerView';
import SettingsView from '@/components/views/SettingsView';
import SystemView from '@/components/views/SystemView';
import TodayView from '@/components/views/TodayView';
import CommandPalette from './CommandPalette';
import Composer from './Composer';
import ViewErrorBoundary from './ErrorBoundary';
import GestureLayer from '@/components/gesture/GestureLayer';
import Island from './Island';
import Onboarding from './Onboarding';
import Rail from './Rail';
import type { ViewProps } from './ViewFrame';
import Wallpaper from './Wallpaper';
import { NAV } from './nav';

const VIEWS: Record<ViewId, ComponentType<ViewProps>> = {
  today: TodayView,
  missions: MissionsView,
  planner: PlannerView,
  decks: DecksView,
  system: SystemView,
  activity: ActivityView,
  settings: SettingsView,
};

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

/** 전역 단축키: 명령 팔레트, 입력창 포커스, 화면 전환 */
function useGlobalShortcuts() {
  const { navigate, setPaletteOpen, paletteOpen, focusComposer } = useApp();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(!paletteOpen);
        return;
      }
      if (mod && /^[1-7]$/.test(e.key)) {
        e.preventDefault();
        navigate(VIEW_IDS[Number(e.key) - 1]);
        return;
      }
      if (e.key === '/' && !mod && !e.altKey && !isTypingTarget(e.target)) {
        e.preventDefault();
        focusComposer();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, setPaletteOpen, paletteOpen, focusComposer]);
}

/** 설정이 켜져 있으면 끝난 미션의 답변을 읽어 준다 */
function useSpeakAnswers() {
  const { settings, speak } = useApp();
  const { missions } = useMissions();
  const spoken = useRef(new Set<string>());
  const baseline = useRef(0);
  useEffect(() => {
    if (!baseline.current) baseline.current = Date.now();
    if (!settings.speakAnswers) return;
    for (const m of Object.values(missions)) {
      if (m.status !== 'done' || !m.finishedAt || !m.answer) continue;
      const key = `${m.id}:${m.finishedAt}`;
      // 앱을 연 뒤에 끝난 미션만 읽는다.
      if (m.finishedAt < baseline.current || spoken.current.has(key)) continue;
      spoken.current.add(key);
      speak(m.answer.replace(/[#*`>_~-]/g, ' ').slice(0, 500));
    }
  }, [missions, settings.speakAnswers, speak]);
}

export default function AppShell() {
  const { status, settings, resolvedTheme, view, chromeHidden, bootstrap, reload } = useApp();
  const { activeIds } = useMissions();
  const [visited, setVisited] = useState<ReadonlySet<ViewId>>(() => new Set([view]));

  // 한 번 연 뷰는 상태를 유지한다.
  if (!visited.has(view)) setVisited(new Set(visited).add(view));

  // 첫 화면을 그린 뒤 나머지 뷰도 마운트한다. 명령 팔레트가 모든 명령을 알게 되고 화면 전환도 즉시 된다.
  // 숨은 뷰는 active가 false라 폴링과 애니메이션을 돌리지 않는다.
  useEffect(() => {
    const mountAll = () => setVisited(new Set(NAV.map((n) => n.id)));
    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(mountAll, { timeout: 2500 });
      return () => window.cancelIdleCallback(handle);
    }
    const timer = setTimeout(mountAll, 1500);
    return () => clearTimeout(timer);
  }, []);

  useGlobalShortcuts();
  useSpeakAnswers();

  return (
    <div className="app">
      <Wallpaper id={settings.wallpaper} theme={resolvedTheme} energized={activeIds.length > 0} />
      {bootstrap?.desktop && <div className="app-drag" aria-hidden="true" />}

      <main>
        {NAV.map(({ id, label }) => {
          if (!visited.has(id)) return null;
          const View = VIEWS[id];
          const isActive = id === view;
          return (
            <section key={id} className="view-slot" data-active={isActive ? '' : undefined} inert={!isActive} aria-label={label}>
              <ViewActiveContext.Provider value={isActive}>
                <ViewErrorBoundary label={label}>
                  <View active={isActive} />
                </ViewErrorBoundary>
              </ViewActiveContext.Provider>
            </section>
          );
        })}
      </main>

      {!chromeHidden && (
        <>
          <div className="edge-top" aria-hidden="true" />
          <div className="edge-bottom" aria-hidden="true" />
          <Rail />
          <Island />
        </>
      )}
      <Composer />

      {status === 'error' && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-6" style={{ background: 'var(--scrim)' }}>
          <Material tier="thick" className="max-w-sm p-6 text-center" radius={26}>
            <ServerOff size={26} className="mx-auto text-label-2" aria-hidden="true" />
            <h1 className="mt-3 text-title3 text-label">앱 서버에 연결할 수 없어요</h1>
            <p className="mt-2 text-callout text-label-2">앱이 실행 중인지 확인한 뒤 다시 시도해 주세요. 저장된 데이터는 그대로예요.</p>
            <Button variant="primary" icon={RefreshCw} className="mt-4 !rounded-full" onClick={() => void reload()}>
              다시 시도
            </Button>
          </Material>
        </div>
      )}

      <CommandPalette />
      <Onboarding />
      <GestureLayer />
    </div>
  );
}
