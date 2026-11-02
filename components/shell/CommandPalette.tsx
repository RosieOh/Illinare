'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CornerDownLeft,
  Hand,
  Moon,
  PanelTop,
  Play,
  Plus,
  Search,
  ShieldAlert,
  Sparkles,
  Sun,
  Waypoints,
} from 'lucide-react';
import { Kbd, Sheet } from '@/components/glass';
import { useApp } from '@/context/AppContext';
import { useMissions } from '@/context/MissionsContext';
import { api } from '@/lib/client/api';
import { fuzzyScore } from '@/lib/client/fuzzy';
import type { Routine } from '@/lib/contracts';
import { useCommands, type Command } from './commands';
import { NAV } from './nav';

const GROUP_ORDER = ['승인', '최근 미션', '루틴', '이동', '동작'];

function useBaseCommands(routines: Routine[]): Command[] {
  const {
    navigate,
    focusComposer,
    settings,
    patchSettings,
    resolvedTheme,
    gestureEnabled,
    setGestureEnabled,
    bootstrap,
  } = useApp();
  const { summaries, focus, start, pendingApprovals } = useMissions();
  const mod = bootstrap?.platform === 'darwin' ? '⌘' : 'Ctrl';

  return useMemo(() => {
    const list: Command[] = [];

    if (pendingApprovals.length > 0) {
      const first = pendingApprovals[0];
      list.push({
        id: 'approvals',
        group: '승인',
        title: `승인 대기 ${pendingApprovals.length}건 확인`,
        subtitle: first.approval.summary,
        icon: ShieldAlert,
        keywords: ['승인', 'approve'],
        run: () => {
          focus(first.missionId);
          navigate('missions');
        },
      });
    }

    list.push({
      id: 'new-mission',
      group: '동작',
      title: '새 미션',
      subtitle: '입력창으로 이동',
      icon: Plus,
      shortcut: '/',
      keywords: ['맡기기', 'mission', 'new'],
      run: () => {
        focus(null);
        focusComposer();
      },
    });

    NAV.forEach((item, i) =>
      list.push({
        id: `go-${item.id}`,
        group: '이동',
        title: item.label,
        icon: item.icon,
        shortcut: `${mod} ${i + 1}`,
        keywords: [item.id],
        run: () => navigate(item.id),
      })
    );

    const nextTheme = resolvedTheme === 'dark' ? 'light' : 'dark';
    list.push({
      id: 'theme-toggle',
      group: '동작',
      title: nextTheme === 'dark' ? '어두운 테마로 전환' : '밝은 테마로 전환',
      icon: nextTheme === 'dark' ? Moon : Sun,
      keywords: ['테마', 'theme', '다크', '라이트'],
      run: () => void patchSettings({ theme: nextTheme }),
    });
    list.push({
      id: 'transparency-toggle',
      group: '동작',
      title: settings.reduceTransparency ? '유리 효과 켜기' : '유리 효과 줄이기',
      subtitle: '불투명한 표면으로 전환해 대비를 높여요',
      icon: PanelTop,
      keywords: ['투명', '접근성', 'transparency'],
      run: () => void patchSettings({ reduceTransparency: !settings.reduceTransparency }),
    });
    list.push({
      id: 'gesture-toggle',
      group: '동작',
      title: gestureEnabled ? '제스처 끄기' : '제스처 켜기',
      subtitle: '카메라로 손 제스처를 인식해요. 영상은 기기 밖으로 나가지 않아요',
      icon: Hand,
      keywords: ['제스처', 'gesture', '카메라'],
      run: () => setGestureEnabled(!gestureEnabled),
    });

    routines.forEach((r) =>
      list.push({
        id: `routine-${r.id}`,
        group: '루틴',
        title: r.title,
        subtitle: r.goal,
        icon: Play,
        keywords: ['루틴', 'routine'],
        run: () => {
          void start(r.goal);
          navigate('missions');
        },
      })
    );

    summaries.slice(0, 5).forEach((s) =>
      list.push({
        id: `mission-${s.id}`,
        group: '최근 미션',
        title: s.title,
        subtitle: s.goal === s.title ? undefined : s.goal,
        icon: Waypoints,
        run: () => {
          focus(s.id);
          navigate('missions');
        },
      })
    );

    return list;
  }, [
    pendingApprovals,
    mod,
    resolvedTheme,
    settings.reduceTransparency,
    gestureEnabled,
    routines,
    summaries,
    focus,
    focusComposer,
    navigate,
    patchSettings,
    setGestureEnabled,
    start,
  ]);
}

export default function CommandPalette() {
  const { paletteOpen, setPaletteOpen } = useApp();
  const close = () => setPaletteOpen(false);
  return (
    <Sheet open={paletteOpen} onClose={close} variant="top" width={600} ariaLabel="명령 찾기" showClose={false} bare glass="clear">
      <PaletteBody onClose={close} />
    </Sheet>
  );
}

function PaletteBody({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const base = useBaseCommands(routines);
  const registered = useCommands();
  const activeRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    let alive = true;
    api
      .get<{ routines: Routine[] }>('/api/routines')
      .then((data) => {
        if (alive) setRoutines(data.routines);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const rows = useMemo(() => {
    const all = [...base, ...registered];
    const q = query.trim();
    if (!q) {
      const rank = (g: string) => {
        const i = GROUP_ORDER.indexOf(g);
        return i === -1 ? GROUP_ORDER.length : i;
      };
      return [...all].sort((a, b) => rank(a.group) - rank(b.group));
    }
    return all
      .map((command) => ({
        command,
        score: fuzzyScore(q, command.title, command.subtitle ?? '', ...(command.keywords ?? [])),
      }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map((r) => r.command);
  }, [base, registered, query]);

  const index = rows.length === 0 ? -1 : Math.min(activeIndex, rows.length - 1);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const runRow = (command: Command) => {
    onClose();
    command.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(rows.length ? (index + 1) % rows.length : 0);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(rows.length ? (index - 1 + rows.length) % rows.length : 0);
    } else if (e.key === 'Enter' && rows[index]) {
      e.preventDefault();
      runRow(rows[index]);
    }
  };

  const showGroups = !query.trim();

  return (
    <div className="flex max-h-[min(70vh,560px)] flex-col" onKeyDown={onKeyDown}>
      <div className="flex shrink-0 items-center gap-3 px-5 py-4" style={{ boxShadow: 'inset 0 -0.5px 0 var(--separator)' }}>
        <Search size={18} className="shrink-0 text-label-3" aria-hidden="true" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(0);
          }}
          placeholder="이동하거나 실행할 일을 찾아보세요"
          aria-label="명령 검색"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={index >= 0 ? `palette-row-${rows[index].id}` : undefined}
          className="min-w-0 flex-1 bg-transparent text-headline font-normal outline-none"
          autoComplete="off"
          spellCheck={false}
          autoFocus
        />
        <Kbd>Esc</Kbd>
      </div>

      <ul id="palette-list" role="listbox" aria-label="명령 목록" className="min-h-0 flex-1 overflow-y-auto p-2">
        {rows.map((command, i) => {
          const Icon = command.icon ?? Sparkles;
          const active = i === index;
          const newGroup = showGroups && (i === 0 || rows[i - 1].group !== command.group);
          return (
            <li
              key={command.id}
              id={`palette-row-${command.id}`}
              ref={active ? activeRef : undefined}
              role="option"
              aria-selected={active}
              onPointerMove={() => setActiveIndex(i)}
              onClick={() => runRow(command)}
              className={newGroup && i > 0 ? 'mt-3' : ''}
            >
              {newGroup && (
                <div className="px-3 pb-1 text-footnote font-medium text-label-3" aria-hidden="true">
                  {command.group}
                </div>
              )}
              <div
                className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-[12px] px-3 py-1.5 ${
                  active ? 'bg-[var(--accent-tint)]' : ''
                }`}
              >
                <Icon size={17} className={`shrink-0 ${active ? 'text-accent-text' : 'text-label-2'}`} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-callout font-medium text-label">{command.title}</div>
                  {command.subtitle && <div className="truncate text-subhead text-label-2">{command.subtitle}</div>}
                </div>
                {command.shortcut && <Kbd>{command.shortcut}</Kbd>}
                {active && !command.shortcut && <CornerDownLeft size={14} className="shrink-0 text-label-3" aria-hidden="true" />}
              </div>
            </li>
          );
        })}
        {rows.length === 0 && (
          <li className="px-3 py-10 text-center text-callout text-label-2" role="presentation">
            &lsquo;{query}&rsquo;에 맞는 명령이 없어요. 입력창에 적으면 미션으로 맡길 수 있어요.
          </li>
        )}
      </ul>
    </div>
  );
}
