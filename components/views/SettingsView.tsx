'use client';

import { useEffect, useMemo, useRef, type ComponentType } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  Brain,
  ChevronRight,
  Cpu,
  Database,
  Info,
  Mic,
  Repeat,
  ShieldCheck,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react';
import { IconButton, Material, spring } from '@/components/glass';
import { AiSection } from '@/components/settings/AiSection';
import { GeneralSection } from '@/components/settings/GeneralSection';
import { AboutSection, DataSection, VoiceSection } from '@/components/settings/InfoSections';
import { MemorySection, RoutinesSection } from '@/components/settings/ListSections';
import { PermissionsSection } from '@/components/settings/PermissionsSection';
import {
  goToSection,
  SavedMark,
  SavedNotifyContext,
  useSavedMark,
  useSettingsSection,
  type SettingsSection,
} from '@/components/settings/shared';
import { useRegisterCommands, type Command } from '@/components/shell/commands';
import { ViewHeader, ViewScroll, type ViewProps } from '@/components/shell/ViewFrame';

const SECTIONS: Array<{ id: SettingsSection; label: string; icon: LucideIcon; Panel: ComponentType; keywords: string[] }> = [
  { id: 'general', label: '일반', icon: SlidersHorizontal, Panel: GeneralSection, keywords: ['이름', '테마', '배경화면', '날씨', '투명도'] },
  { id: 'ai', label: 'AI', icon: Cpu, Panel: AiSection, keywords: ['API 키', '모델', '비용', '상한', '계획'] },
  { id: 'permissions', label: '권한', icon: ShieldCheck, Panel: PermissionsSection, keywords: ['도구', '승인', '차단', '허용'] },
  { id: 'memory', label: '기억', icon: Brain, Panel: MemorySection, keywords: ['메모리', '선호'] },
  { id: 'routines', label: '루틴', icon: Repeat, Panel: RoutinesSection, keywords: ['반복', '자동화'] },
  { id: 'voice', label: '음성·제스처', icon: Mic, Panel: VoiceSection, keywords: ['읽어 주기', '카메라', '손동작'] },
  { id: 'data', label: '데이터', icon: Database, Panel: DataSection, keywords: ['내보내기', '삭제', '저장 위치', '개인정보'] },
  { id: 'about', label: '정보', icon: Info, Panel: AboutSection, keywords: ['버전', '라이선스', '단축키'] },
];

export default function SettingsView({ active }: ViewProps) {
  const hashSection = useSettingsSection();
  const [saved, notifySaved] = useSavedMark();
  const root = useRef<HTMLDivElement>(null);

  // 넓은 화면에서 해시에 항목이 없으면 일반을 보여주고, 좁은 화면에서는 목록을 보여준다.
  const shown = hashSection ?? 'general';
  const current = SECTIONS.find((s) => s.id === shown) ?? SECTIONS[0];
  const Panel = current.Panel;

  useEffect(() => {
    if (active) root.current?.closest('.view-scroll')?.scrollTo({ top: 0 });
  }, [active, shown]);

  const commands = useMemo<Command[]>(
    () =>
      SECTIONS.map((s) => ({
        id: `settings:${s.id}`,
        title: `설정: ${s.label}`,
        group: '설정',
        icon: s.icon,
        keywords: s.keywords,
        run: () => goToSection(s.id),
      })),
    []
  );
  useRegisterCommands(commands);

  return (
    <ViewScroll>
      <div ref={root} className="@container">
        <ViewHeader title="설정" />
        <div className="grid items-start gap-4 @3xl:grid-cols-[208px_minmax(0,1fr)]">
          <nav aria-label="설정 항목" className={`${hashSection ? 'hidden @3xl:block' : ''} @3xl:sticky @3xl:top-0`}>
            <Material className="p-2" radius={22}>
              <ul>
                {SECTIONS.map((s) => {
                  const selected = s.id === shown;
                  const Icon = s.icon;
                  // 좁은 화면의 목록은 고른 항목이 없으므로 넓은 화면에서만 선택을 표시한다.
                  const tone = selected
                    ? hashSection
                      ? 'font-medium text-label'
                      : 'text-label @3xl:font-medium'
                    : 'text-label @3xl:text-label-2 @3xl:hover:text-label';
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        aria-current={selected ? 'page' : undefined}
                        onClick={() => goToSection(s.id)}
                        className={`press relative flex h-11 w-full items-center gap-2.5 rounded-[14px] px-3 text-left text-callout ${tone}`}
                      >
                        {selected && (
                          <motion.span
                            layoutId="settings-selection"
                            transition={spring.snappy}
                            className="absolute inset-0 hidden rounded-[14px] bg-[var(--selected)] shadow-[0_1px_3px_rgba(0,0,0,.1)] @3xl:block"
                            aria-hidden="true"
                          />
                        )}
                        <Icon size={17} className="relative shrink-0" aria-hidden="true" />
                        <span className="relative min-w-0 flex-1 truncate">{s.label}</span>
                        <ChevronRight size={15} className="relative shrink-0 text-label-3 @3xl:hidden" aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Material>
          </nav>

          <div className={hashSection ? '' : 'hidden @3xl:block'}>
            <Material as="section" className="min-w-0 p-5" radius={24} aria-label={current.label}>
              <header className="mb-4 flex items-center gap-2">
                <IconButton
                  icon={ArrowLeft}
                  label="설정 목록으로"
                  className="-ml-1.5 @3xl:hidden"
                  onClick={() => goToSection(null)}
                />
                <h2 className="min-w-0 flex-1 text-title2 text-label">{current.label}</h2>
                <SavedMark visible={saved} />
              </header>
              <SavedNotifyContext.Provider value={notifySaved}>
                <Panel />
              </SavedNotifyContext.Provider>
            </Material>
          </div>
        </div>
      </div>
    </ViewScroll>
  );
}
