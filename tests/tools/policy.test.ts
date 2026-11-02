import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings, type ToolPolicy, type ToolRisk } from '@/lib/contracts';
import { getTool, listTools, toolsForAgent, type ToolDef } from '@/lib/tools';
import { anthropicToolsFor } from '@/lib/tools/anthropic';
import { effectiveRisk, gate, toolInfos } from '@/lib/tools/policy';

function fakeTool(risk: ToolRisk, extra: Partial<ToolDef<unknown>> = {}): ToolDef<unknown> {
  return {
    name: 'fake',
    description: '',
    risk,
    group: 'data',
    agents: ['operator'],
    schema: {},
    summarize: () => '',
    run: async () => '',
    ...extra,
  };
}

function settings(policy?: ToolPolicy): Settings {
  const toolPolicies: Settings['toolPolicies'] = policy ? { fake: policy } : {};
  return { ...DEFAULT_SETTINGS, toolPolicies };
}

const cases: [ToolRisk, boolean, boolean, ToolPolicy | undefined, 'run' | 'ask' | 'block'][] = [
  // risk, egress, tainted, policy, 기대
  ['safe', false, false, undefined, 'run'],
  ['safe', false, true, undefined, 'run'],
  ['safe', true, false, undefined, 'run'],
  ['safe', true, true, undefined, 'ask'],
  ['safe', true, true, 'allow', 'ask'],
  ['safe', false, false, 'ask', 'ask'],
  ['safe', false, false, 'block', 'block'],
  ['safe', true, true, 'block', 'block'],
  ['confirm', false, false, undefined, 'ask'],
  ['confirm', false, false, 'allow', 'run'],
  ['confirm', false, false, 'ask', 'ask'],
  ['confirm', false, false, 'block', 'block'],
  // 외부 내용을 읽은 뒤에는 '항상 허용'도 통하지 않는다.
  ['confirm', false, true, 'allow', 'ask'],
  ['confirm', false, true, undefined, 'ask'],
  ['confirm', true, false, 'allow', 'run'],
  ['confirm', true, true, 'allow', 'ask'],
  ['danger', false, false, undefined, 'ask'],
  ['danger', false, false, 'allow', 'ask'],
  ['danger', false, false, 'ask', 'ask'],
  ['danger', false, false, 'block', 'block'],
];

describe('gate', () => {
  it.each(cases)('risk=%s egress=%s tainted=%s policy=%s → %s', (risk, egress, tainted, policy, expected) => {
    const result = gate(fakeTool(risk, { egress }), { settings: settings(policy), tainted });
    expect(result.action).toBe(expected);
    expect(result.reason).toBeTruthy();
  });

  it('explains taint escalation', () => {
    const { reason } = gate(fakeTool('safe', { egress: true }), { settings: settings(), tainted: true });
    expect(reason).toMatch(/외부/);
  });

  it('uses input-dependent risk when input is given, and fails closed without it', () => {
    const tool = fakeTool('safe', { riskFor: (i) => ((i as { ok: boolean }).ok ? 'safe' : 'confirm') });
    expect(gate(tool, { settings: settings(), tainted: false, input: { ok: true } }).action).toBe('run');
    expect(gate(tool, { settings: settings(), tainted: false, input: { ok: false } }).action).toBe('ask');
    expect(gate(tool, { settings: settings(), tainted: false }).action).toBe('ask');
    expect(effectiveRisk(tool)).toBe('confirm');
  });

  it('fails closed when riskFor throws', () => {
    const tool = fakeTool('safe', {
      riskFor: () => {
        throw new Error('boom');
      },
    });
    expect(effectiveRisk(tool, {})).toBe('confirm');
  });
});

describe('registered tools', () => {
  const names = () => listTools().map((t) => t.name);

  it('registers the full catalog in a stable order', () => {
    expect(names()).toEqual([...names()].sort((a, b) => a.localeCompare(b)));
    for (const name of [
      'get_volume', 'set_volume', 'get_dark_mode', 'set_dark_mode', 'lock_screen', 'sleep_system',
      'send_notification', 'say_text', 'get_clipboard', 'set_clipboard', 'get_system_stats', 'list_processes',
      'list_running_apps', 'open_app', 'focus_app', 'quit_app', 'open_url',
      'list_files', 'read_file', 'search_files', 'write_file', 'append_file', 'delete_file',
      'get_current_time', 'get_weather', 'take_screenshot',
      'list_tasks', 'add_task', 'complete_task', 'remove_task', 'list_events', 'add_event', 'remove_event',
      'save_note', 'create_deck', 'remember',
    ]) {
      expect(getTool(name), name).toBeDefined();
    }
  });

  it('enforces least privilege per agent', () => {
    const of = (agent: Parameters<typeof toolsForAgent>[0]) => listTools().filter((t) => t.agents.includes(agent)).map((t) => t.name);
    expect(of('researcher')).toEqual(['get_weather']);
    expect(of('analyst').sort()).toEqual(['get_current_time', 'get_system_stats']);
    expect(of('writer').sort()).toEqual(['create_deck', 'get_current_time', 'save_note']);
    expect(of('conductor')).toEqual([]);
    expect(of('archivist').sort()).toEqual(['append_file', 'delete_file', 'list_files', 'read_file', 'search_files', 'write_file']);
    // 파일을 만지는 에이전트에게 네트워크로 나가는 도구는 없다.
    expect(listTools().filter((t) => t.agents.includes('archivist') && t.egress)).toEqual([]);
    expect(of('planner')).toEqual(expect.arrayContaining(['add_task', 'add_event', 'get_current_time', 'remember']));
    expect(of('operator')).toEqual(expect.arrayContaining(['set_volume', 'open_app', 'get_clipboard', 'take_screenshot', 'get_system_stats']));
    expect(of('operator')).not.toContain('read_file');
  });

  it('classifies sensitive tools as the policy requires', () => {
    expect(getTool('get_clipboard')?.risk).toBe('confirm');
    expect(getTool('get_clipboard')?.readsUntrusted).toBe(true);
    expect(getTool('take_screenshot')?.risk).toBe('confirm');
    expect(getTool('read_file')?.readsUntrusted).toBe(true);
    expect(getTool('list_files')?.readsUntrusted).toBe(true);
    expect(getTool('search_files')?.readsUntrusted).toBe(true);
    expect(getTool('open_url')?.egress).toBe(true);
    expect(getTool('get_weather')?.egress).toBe(true);
    expect(getTool('delete_file')?.risk).toBe('danger');
    expect(getTool('quit_app')?.risk).toBe('danger');
    expect(getTool('remember')?.risk).toBe('confirm');
  });

  it('builds SDK tool definitions with eager streaming and no volatile text', () => {
    const defs = anthropicToolsFor('archivist');
    expect(defs.length).toBeGreaterThan(0);
    for (const def of defs) {
      expect(def.eager_input_streaming).toBe(true);
      expect(def.input_schema.type).toBe('object');
      expect(def.description).not.toMatch(/^\[/);
    }
    expect(defs.map((d) => d.name)).toEqual([...defs.map((d) => d.name)].sort((a, b) => a.localeCompare(b)));
    expect(anthropicToolsFor('conductor')).toEqual([]);
  });

  it('toolInfos downgrades allow on danger tools', () => {
    const infos = toolInfos({ ...DEFAULT_SETTINGS, toolPolicies: { delete_file: 'allow', write_file: 'allow' } });
    expect(infos.find((t) => t.name === 'delete_file')?.policy).toBe('ask');
    expect(infos.find((t) => t.name === 'write_file')?.policy).toBe('allow');
  });
});
