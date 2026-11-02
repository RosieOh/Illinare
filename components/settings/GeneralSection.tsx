'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import type { ThemeSetting, WallpaperId } from '@/lib/contracts';
import { Segmented, Toggle } from '@/components/glass';
import { staticBackground, WALLPAPERS } from '@/components/shell/Wallpaper';
import { useApp } from '@/context/AppContext';
import { CommitField, Group, useSave } from './shared';

const WALLPAPER_IDS = Object.keys(WALLPAPERS) as WallpaperId[];

export function GeneralSection() {
  const { settings, resolvedTheme } = useApp();
  const save = useSave();

  return (
    <div className="space-y-5">
      <Group>
        <CommitField
          label="이름"
          hint="인사말과 답변에서 이렇게 불러요. 비워 두면 호칭을 쓰지 않아요."
          placeholder="이름"
          maxLength={40}
          value={settings.displayName}
          onCommit={(displayName) => void save({ displayName })}
        />
      </Group>

      <Group title="화면 모드">
        <Segmented<ThemeSetting>
          label="화면 모드"
          value={settings.theme}
          onChange={(theme) => void save({ theme })}
          options={[
            { value: 'system', label: '시스템', icon: Monitor },
            { value: 'light', label: '밝게', icon: Sun },
            { value: 'dark', label: '어둡게', icon: Moon },
          ]}
        />
      </Group>

      <Group title="배경화면">
        <div role="radiogroup" aria-label="배경화면" className="grid grid-cols-2 gap-3 @2xl:grid-cols-4">
          {WALLPAPER_IDS.map((id) => {
            const selected = settings.wallpaper === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => void save({ wallpaper: id })}
                className="press text-left"
              >
                <span
                  className="block aspect-[16/10] rounded-[14px]"
                  style={{
                    background: staticBackground(WALLPAPERS[id][resolvedTheme]),
                    boxShadow: selected
                      ? '0 0 0 2px var(--surface-2), 0 0 0 4px var(--accent)'
                      : 'inset 0 0 0 0.5px var(--separator)',
                  }}
                />
                <span className={`mt-2 block text-subhead ${selected ? 'font-semibold text-label' : 'text-label-2'}`}>
                  {WALLPAPERS[id].label}
                </span>
              </button>
            );
          })}
        </div>
      </Group>

      <Group>
        <Toggle
          label="투명도 줄이기"
          description="유리 효과 대신 불투명한 표면을 써요. 글자가 더 또렷해지고 그래픽 부담이 줄어요."
          checked={settings.reduceTransparency}
          onChange={(reduceTransparency) => void save({ reduceTransparency })}
        />
      </Group>

      <Group>
        <CommitField
          label="날씨 위치"
          hint="오늘 화면의 날씨에 써요. 영문 도시 이름이 가장 잘 찾아져요. 이 이름은 wttr.in으로 전송돼요."
          placeholder="Seoul"
          maxLength={48}
          value={settings.weatherCity}
          onCommit={(weatherCity) => void save({ weatherCity })}
          validate={(v) => (v.trim() ? null : '도시 이름을 입력해 주세요.')}
        />
      </Group>
    </div>
  );
}
