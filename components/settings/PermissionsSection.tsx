'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search, ShieldQuestion } from 'lucide-react';
import { AGENTS, type ToolInfo, type ToolPolicy, type ToolRisk } from '@/lib/contracts';
import { AgentAvatar, Badge, Button, EmptyState, Select, Skeleton, TextField, Tooltip } from '@/components/glass';
import { useApp } from '@/context/AppContext';
import { api, ClientApiError } from '@/lib/client/api';
import { Group, useSave } from './shared';
import { TOOL_LABELS } from './toolLabels';

const GROUP_LABEL: Record<ToolInfo['group'], string> = {
  system: '시스템',
  apps: '앱',
  files: '파일',
  data: '정보',
  planner: '플래너',
  docs: '문서',
  memory: '기억',
  web: '웹',
};
const GROUP_ORDER = Object.keys(GROUP_LABEL) as ToolInfo['group'][];

const RISK: Record<ToolRisk, { label: string; tone: 'neutral' | 'warning' | 'danger'; byDefault: string }> = {
  safe: { label: '안전', tone: 'neutral', byDefault: '기본 (바로 실행)' },
  confirm: { label: '변경', tone: 'warning', byDefault: '기본 (먼저 묻기)' },
  danger: { label: '위험', tone: 'danger', byDefault: '기본 (항상 묻기)' },
};

function policyOptions(tool: ToolInfo) {
  const options: Array<{ value: ToolPolicy; label: string }> = [{ value: 'default', label: RISK[tool.risk].byDefault }];
  if (tool.risk !== 'danger') options.push({ value: 'allow', label: '항상 허용' });
  options.push({ value: 'ask', label: '항상 묻기' }, { value: 'block', label: '차단' });
  return options;
}

/** 새 도구에 이름을 아직 붙이지 않았으면 설명의 첫 문장으로 대신한다. */
function toolLabel(tool: ToolInfo): string {
  return TOOL_LABELS[tool.name] ?? tool.description.split(/(?<=\.)\s/)[0];
}

export function PermissionsSection() {
  const { settings } = useApp();
  const save = useSave();
  const [tools, setTools] = useState<ToolInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    api
      .get<{ tools: ToolInfo[] }>('/api/tools')
      .then((data) => {
        if (!alive) return;
        setTools(data.tools);
        setError(null);
      })
      .catch((err) => {
        if (alive) setError(err instanceof ClientApiError ? err.message : '도구 목록을 불러오지 못했어요.');
      });
    return () => {
      alive = false;
    };
  }, [attempt]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (tools ?? []).filter((t) => !q || `${t.name} ${t.description} ${TOOL_LABELS[t.name] ?? ''}`.toLowerCase().includes(q));
    return GROUP_ORDER.map((group) => ({ group, items: list.filter((t) => t.group === group) })).filter((g) => g.items.length);
  }, [tools, query]);

  const setPolicy = (name: string, policy: ToolPolicy) => {
    const next = { ...settings.toolPolicies };
    if (policy === 'default') delete next[name];
    else next[name] = policy;
    void save({ toolPolicies: next });
  };

  return (
    <div className="space-y-5">
      <Group>
        <div className="space-y-1.5 text-subhead text-label-2">
          <p>에이전트마다 쓸 수 있는 도구가 정해져 있어요. 여기서는 각 도구를 실행하기 전에 물어볼지 정해요.</p>
          <p>
            위험 등급 도구는 항상 먼저 물어요. 파일이나 웹처럼 외부 내용을 읽은 뒤에 데이터를 밖으로 내보내는 도구도 항상 허용으로 해 두었더라도 먼저 물어요. 외부 내용에 숨은 지시로 정보가 새는 일을 막기 위해서예요.
          </p>
        </div>
      </Group>

      {error && !tools && (
        <EmptyState
          compact
          icon={ShieldQuestion}
          title="도구 목록을 불러오지 못했어요"
          description={error}
          action={<Button onClick={() => setAttempt((n) => n + 1)}>다시 시도</Button>}
        />
      )}

      {!tools && !error && (
        <div className="space-y-3" aria-busy="true" aria-label="도구 목록을 불러오는 중">
          <Skeleton height={48} radius={12} />
          <Skeleton height={48} radius={12} />
          <Skeleton height={48} radius={12} />
        </div>
      )}

      {tools && (
        <>
          <TextField
            aria-label="도구 찾기"
            placeholder={`도구 ${tools.length}개에서 찾기`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            leading={<Search size={15} aria-hidden="true" />}
          />
          {groups.length === 0 && <p className="text-callout text-label-2">찾는 도구가 없어요.</p>}
          {groups.map(({ group, items }) => (
            <Group key={group} title={GROUP_LABEL[group]}>
              <ul className="divide-y divide-separator">
                {items.map((tool) => (
                  <ToolRow
                    key={tool.name}
                    tool={tool}
                    policy={settings.toolPolicies[tool.name] ?? 'default'}
                    onChange={(p) => setPolicy(tool.name, p)}
                  />
                ))}
              </ul>
            </Group>
          ))}
        </>
      )}
    </div>
  );
}

function ToolRow({ tool, policy, onChange }: { tool: ToolInfo; policy: ToolPolicy; onChange: (p: ToolPolicy) => void }) {
  const risk = RISK[tool.risk];
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
      <div className={`min-w-[200px] flex-1 ${tool.available ? '' : 'opacity-60'}`}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-callout font-medium text-label">{toolLabel(tool)}</span>
          <Badge tone={risk.tone} className={risk.tone === 'warning' ? 'approval-pill' : undefined}>{risk.label}</Badge>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          <code className="font-mono text-footnote break-all text-label-2">{tool.name}</code>
          <span className="flex items-center gap-1">
            {tool.agents.map((agent) => (
              <Tooltip key={agent} content={AGENTS[agent].name}>
                <span className="inline-flex" tabIndex={-1}>
                  <AgentAvatar agent={agent} size="xs" />
                </span>
              </Tooltip>
            ))}
          </span>
        </div>
        {!tool.available && <p className="mt-1 text-footnote text-label-2">이 운영체제에서는 쓸 수 없어요.</p>}
      </div>
      <Select
        aria-label={`${tool.name} 실행 정책`}
        disabled={!tool.available}
        options={policyOptions(tool)}
        value={tool.risk === 'danger' && policy === 'allow' ? 'default' : policy}
        onChange={(e) => onChange(e.target.value as ToolPolicy)}
        wrapperClassName="w-[172px] shrink-0"
      />
    </li>
  );
}
