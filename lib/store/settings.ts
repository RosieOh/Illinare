import {
  DEFAULT_SETTINGS,
  MODEL_PRESETS,
  type ModelPreset,
  type Settings,
  type ThemeSetting,
  type ToolPolicy,
  type WallpaperId,
} from '@/lib/contracts';
import { ApiError } from '@/lib/server/http';
import { dataPath, readJson, updateJson } from './json';

const file = () => dataPath('settings.json');

const THEMES: ThemeSetting[] = ['system', 'light', 'dark'];
const WALLPAPERS: WallpaperId[] = ['tide', 'dune', 'aurora', 'graphite'];
const POLICIES: ToolPolicy[] = ['default', 'allow', 'ask', 'block'];
/** 미션 1회 비용 상한의 허용 범위 (USD) */
const BUDGET_MIN = 0.05;
const BUDGET_MAX = 100;

export async function getSettings(): Promise<Settings> {
  const saved = await readJson<Partial<Settings>>(file(), {});
  return { ...DEFAULT_SETTINGS, ...saved };
}

export async function patchSettings(patch: Partial<Settings>): Promise<Settings> {
  const merged = await updateJson<Partial<Settings>>(file(), {}, (current) => ({ ...current, ...patch }));
  return { ...DEFAULT_SETTINGS, ...merged };
}

export async function setToolPolicy(name: string, policy: ToolPolicy): Promise<Settings> {
  const merged = await updateJson<Partial<Settings>>(file(), {}, (current) => {
    const toolPolicies = { ...(current.toolPolicies ?? {}) };
    if (policy === 'default') delete toolPolicies[name];
    else toolPolicies[name] = policy;
    return { ...current, toolPolicies };
  });
  return { ...DEFAULT_SETTINGS, ...merged };
}

/** REST로 들어온 설정 변경을 검사한다. 모르는 키는 버리고, 값이 틀리면 400. */
export function sanitizeSettingsPatch(raw: unknown): Partial<Settings> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ApiError(400, 'invalid_settings', '설정 형식이 올바르지 않아요.');
  }
  const input = raw as Record<string, unknown>;
  const patch: Partial<Settings> = {};

  const fail = (label: string): never => {
    throw new ApiError(400, 'invalid_settings', `${label} 값이 올바르지 않아요.`);
  };
  const text = (key: 'displayName' | 'weatherCity', label: string, max: number) => {
    if (!(key in input)) return;
    const v = input[key];
    if (typeof v !== 'string' || v.length > max) fail(label);
    patch[key] = (v as string).trim();
  };
  const flag = (key: 'reduceTransparency' | 'reviewPlans' | 'speakAnswers' | 'onboarded', label: string) => {
    if (!(key in input)) return;
    if (typeof input[key] !== 'boolean') fail(label);
    patch[key] = input[key] as boolean;
  };

  text('displayName', '이름', 40);
  text('weatherCity', '날씨 위치', 48);
  flag('reduceTransparency', '투명도 줄이기');
  flag('reviewPlans', '계획 검토');
  flag('speakAnswers', '답변 읽기');
  flag('onboarded', '온보딩');

  if ('theme' in input) {
    if (!THEMES.includes(input.theme as ThemeSetting)) fail('테마');
    patch.theme = input.theme as ThemeSetting;
  }
  if ('wallpaper' in input) {
    if (!WALLPAPERS.includes(input.wallpaper as WallpaperId)) fail('배경화면');
    patch.wallpaper = input.wallpaper as WallpaperId;
  }
  if ('modelPreset' in input) {
    if (!(typeof input.modelPreset === 'string' && input.modelPreset in MODEL_PRESETS)) fail('모델 구성');
    patch.modelPreset = input.modelPreset as ModelPreset;
  }
  if ('budgetUsd' in input) {
    const v = input.budgetUsd;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < BUDGET_MIN || v > BUDGET_MAX) {
      fail(`비용 상한(${BUDGET_MIN}~${BUDGET_MAX}달러)`);
    }
    patch.budgetUsd = v as number;
  }
  if ('toolPolicies' in input) {
    const v = input.toolPolicies;
    if (typeof v !== 'object' || v === null || Array.isArray(v)) fail('도구 권한');
    const policies: Record<string, ToolPolicy> = {};
    for (const [name, policy] of Object.entries(v as Record<string, unknown>)) {
      if (!POLICIES.includes(policy as ToolPolicy)) fail('도구 권한');
      if (policy !== 'default') policies[name] = policy as ToolPolicy;
    }
    patch.toolPolicies = policies;
  }
  return patch;
}
