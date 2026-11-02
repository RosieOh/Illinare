'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { DEFAULT_SETTINGS, type Bootstrap, type Settings } from '@/lib/contracts';
import { api, ClientApiError } from '@/lib/client/api';
import { migrateLegacyStorage } from '@/lib/client/legacy';
import { useToast } from '@/components/glass';
import { useMediaQuery } from '@/utils/useMediaQuery';
import { speak as speakText } from '@/utils/speech';

export type ViewId = 'today' | 'missions' | 'planner' | 'decks' | 'system' | 'activity' | 'settings';

export const VIEW_IDS: ViewId[] = ['today', 'missions', 'planner', 'decks', 'system', 'activity', 'settings'];

/** 컴포저가 자신을 등록해 어느 뷰에서든 채우고 포커스할 수 있게 한다. */
export interface ComposerHandle {
  fill: (text: string) => void;
  focus: () => void;
}

interface AppContextValue {
  status: 'loading' | 'ready' | 'error';
  bootstrap: Bootstrap | null;
  settings: Settings;
  /** 낙관적 갱신. 실패하면 되돌리고 알림을 띄운다. */
  patchSettings: (patch: Partial<Settings>) => Promise<boolean>;
  /** 키 저장 등 서버 상태가 바뀐 뒤 호출 */
  reload: () => Promise<void>;
  resolvedTheme: 'light' | 'dark';
  view: ViewId;
  navigate: (view: ViewId) => void;
  /** 발표 전체 화면 등에서 셸(레일, 컴포저, 아일랜드)을 숨긴다 */
  chromeHidden: boolean;
  setChromeHidden: (hidden: boolean) => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  /** 제스처 사용 여부 (제스처 모듈이 구독) */
  gestureEnabled: boolean;
  setGestureEnabled: (enabled: boolean) => void;
  registerComposer: (handle: ComposerHandle | null) => void;
  fillComposer: (text: string) => void;
  focusComposer: () => void;
  speak: (text: string) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

// ─── 해시 라우팅 ─────────────────────────────────────────────
function subscribeHash(callback: () => void) {
  window.addEventListener('hashchange', callback);
  return () => window.removeEventListener('hashchange', callback);
}

function readHashView(): ViewId {
  // 첫 조각만 뷰 이름이다. 뒤는 뷰 안의 위치 (예: #/settings/ai).
  const raw = window.location.hash.replace(/^#\/?/, '').split('/')[0];
  return (VIEW_IDS as string[]).includes(raw) ? (raw as ViewId) : 'today';
}

const THEME_CACHE = 'illionaire_theme';
const TRANSPARENCY_CACHE = 'illionaire_transparency';

export function AppProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [status, setStatus] = useState<AppContextValue['status']>('loading');
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [chromeHidden, setChromeHidden] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [gestureEnabled, setGestureEnabled] = useState(false);
  const composer = useRef<ComposerHandle | null>(null);

  const view = useSyncExternalStore(subscribeHash, readHashView, () => 'today' as ViewId);

  const systemDark = useMediaQuery('(prefers-color-scheme: dark)');
  const osReducedTransparency = useMediaQuery('(prefers-reduced-transparency: reduce)');
  const osMoreContrast = useMediaQuery('(prefers-contrast: more)');
  const resolvedTheme: 'light' | 'dark' =
    settings.theme === 'system' ? (systemDark ? 'dark' : 'light') : settings.theme;
  const reduced = settings.reduceTransparency || osReducedTransparency || osMoreContrast;

  // 테마와 투명도는 <html> 속성으로 반영하고, 첫 페인트 깜빡임 방지용으로 캐시한다 (layout.tsx의 인라인 스크립트가 읽음).
  useEffect(() => {
    if (status !== 'ready') return;
    const root = document.documentElement;
    root.dataset.theme = resolvedTheme;
    root.dataset.transparency = reduced ? 'reduced' : 'full';
    document
      .querySelectorAll('meta[name="theme-color"]')
      .forEach((meta) => meta.setAttribute('content', resolvedTheme === 'dark' ? '#0a1220' : '#e6eef8'));
    try {
      localStorage.setItem(THEME_CACHE, settings.theme);
      localStorage.setItem(TRANSPARENCY_CACHE, settings.reduceTransparency ? '1' : '0');
    } catch {
      /* 저장 공간 접근이 막혀도 화면에는 영향이 없다 */
    }
  }, [status, resolvedTheme, reduced, settings.theme, settings.reduceTransparency]);

  const applyBootstrap = useCallback((data: Bootstrap) => {
    setBootstrap(data);
    setSettings({ ...DEFAULT_SETTINGS, ...data.settings });
    setStatus('ready');
  }, []);

  useEffect(() => {
    let alive = true;
    api
      .get<Bootstrap>('/api/bootstrap')
      .then((data) => {
        if (!alive) return;
        applyBootstrap(data);
        migrateLegacyStorage().catch(() => undefined);
      })
      .catch(() => {
        if (alive) setStatus('error');
      });
    return () => {
      alive = false;
    };
  }, [applyBootstrap]);

  const reload = useCallback(async () => {
    setStatus((cur) => (cur === 'error' ? 'loading' : cur));
    try {
      applyBootstrap(await api.get<Bootstrap>('/api/bootstrap'));
    } catch {
      setStatus('error');
    }
  }, [applyBootstrap]);

  const patchSettings = useCallback(
    async (patch: Partial<Settings>) => {
      let previous: Settings | null = null;
      setSettings((cur) => {
        previous = cur;
        return { ...cur, ...patch };
      });
      try {
        const saved = await api.patch<Settings>('/api/settings', patch);
        setSettings({ ...DEFAULT_SETTINGS, ...saved });
        return true;
      } catch (err) {
        if (previous) setSettings(previous);
        toast({
          tone: 'danger',
          title: '설정을 저장하지 못했어요',
          description: err instanceof ClientApiError ? err.message : undefined,
        });
        return false;
      }
    },
    [toast]
  );

  const navigate = useCallback((next: ViewId) => {
    window.location.hash = `/${next}`;
  }, []);

  const registerComposer = useCallback((handle: ComposerHandle | null) => {
    composer.current = handle;
  }, []);
  const fillComposer = useCallback((text: string) => composer.current?.fill(text), []);
  const focusComposer = useCallback(() => composer.current?.focus(), []);

  const value = useMemo<AppContextValue>(
    () => ({
      status,
      bootstrap,
      settings,
      patchSettings,
      reload,
      resolvedTheme,
      view,
      navigate,
      chromeHidden,
      setChromeHidden,
      paletteOpen,
      setPaletteOpen,
      gestureEnabled,
      setGestureEnabled,
      registerComposer,
      fillComposer,
      focusComposer,
      speak: speakText,
    }),
    [
      status,
      bootstrap,
      settings,
      patchSettings,
      reload,
      resolvedTheme,
      view,
      navigate,
      chromeHidden,
      paletteOpen,
      gestureEnabled,
      registerComposer,
      fillComposer,
      focusComposer,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
