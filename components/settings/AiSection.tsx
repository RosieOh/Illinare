'use client';

import { useState } from 'react';
import type Anthropic from '@anthropic-ai/sdk';
import { ExternalLink, KeyRound, Trash2 } from 'lucide-react';
import { costOf } from '@/lib/agents/pricing';
import { MODEL_PRESETS, type ModelPreset } from '@/lib/contracts';
import { Badge, Button, Sheet, TextField, Toggle, useToast } from '@/components/glass';
import { useApp } from '@/context/AppContext';
import { api, ClientApiError } from '@/lib/client/api';
import { formatCost } from '@/lib/client/format';
import { Group, useSave } from './shared';

const BUDGET_MIN = 0.05;
const BUDGET_MAX = 100;
/** 슬라이더는 흔히 쓰는 범위만 다루고, 더 큰 값은 숫자 칸에 적는다. */
const SLIDER_MAX = 20;

const MODEL_NAME: Record<string, string> = {
  'claude-opus-5-5': 'Opus 5.5',
  'claude-sonnet-5-5': 'Sonnet 5.5',
  'claude-haiku-5-5': 'Haiku 5.5',
};

function price(model: string): { input: number; output: number } {
  // 비용 계산과 같은 표를 쓴다. Haiku 장문 할증을 피하려고 입력은 10만 토큰으로 재서 환산한다.
  const usage = (input_tokens: number, output_tokens: number) => ({ input_tokens, output_tokens }) as Anthropic.Beta.BetaUsage;
  return {
    input: costOf(model, usage(100_000, 0)).costUsd * 10,
    output: costOf(model, usage(0, 1_000_000)).costUsd,
  };
}

function priceLine(model: string): string {
  const p = price(model);
  return `${MODEL_NAME[model] ?? model} 입력 $${p.input} · 출력 $${p.output}`;
}

export function AiSection() {
  const { bootstrap, settings, reload } = useApp();
  const save = useSave();
  const toast = useToast();

  const [key, setKey] = useState('');
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [budgetDraft, setBudgetDraft] = useState<string | null>(null);

  const source = bootstrap?.apiKeySource ?? 'none';
  const mode = bootstrap?.mode ?? 'demo';

  const saveKey = async () => {
    setKeyBusy(true);
    setKeyError(null);
    try {
      await api.put('/api/settings/api-key', { key });
      setKey('');
      await reload();
      toast({ tone: 'success', title: 'API 키를 저장했어요', description: '이제 미션이 실제 Claude로 실행돼요.' });
    } catch (err) {
      setKeyError(err instanceof ClientApiError ? err.message : '키를 저장하지 못했어요.');
    } finally {
      setKeyBusy(false);
    }
  };

  const deleteKey = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.del('/api/settings/api-key');
      setConfirmDelete(false);
      await reload();
      toast({ title: 'API 키를 지웠어요', description: '이제 미션은 데모로 실행돼요.' });
    } catch (err) {
      setDeleteError(err instanceof ClientApiError ? err.message : '키를 지우지 못했어요.');
    } finally {
      setDeleting(false);
    }
  };

  const budgetValue = budgetDraft ?? String(settings.budgetUsd);
  const parsedBudget = Number(budgetValue);
  const budgetInvalid = budgetValue.trim() === '' || !Number.isFinite(parsedBudget) || parsedBudget < BUDGET_MIN || parsedBudget > BUDGET_MAX;

  const commitBudget = () => {
    if (budgetDraft === null || budgetInvalid) return;
    setBudgetDraft(null);
    if (parsedBudget !== settings.budgetUsd) void save({ budgetUsd: parsedBudget });
  };

  return (
    <div className="space-y-5">
      <Group title="실행 방식">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={mode === 'live' ? 'success' : 'neutral'} dot>
            {mode === 'live' ? '실제 모드' : '데모 모드'}
          </Badge>
          <p className="text-subhead text-label-2">
            {mode === 'live'
              ? '미션이 내 API 키로 Claude를 호출하고, 사용량은 내 Anthropic 계정에 청구돼요.'
              : '준비된 예시만 재생해요. AI를 호출하지 않고 내 컴퓨터도 건드리지 않아요.'}
          </p>
        </div>
      </Group>

      <Group title="Anthropic API 키">
        {source === 'env' && (
          <p className="text-callout text-label-2">
            환경 변수 <code className="font-mono text-label">ANTHROPIC_API_KEY</code>의 키를 쓰고 있어요
            {bootstrap?.apiKeyHint ? ` (${bootstrap.apiKeyHint})` : ''}. 앱에서는 바꾸거나 지울 수 없어요.
          </p>
        )}
        {source === 'stored' && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="min-w-0 text-callout text-label">
              저장된 키 <span className="font-mono break-all">{bootstrap?.apiKeyHint}</span>
            </p>
            <Button variant="plain" size="sm" icon={Trash2} className="!text-danger-text" onClick={() => setConfirmDelete(true)}>
              키 지우기
            </Button>
          </div>
        )}
        {source === 'none' && <p className="mb-3 text-callout text-label-2">등록된 키가 없어요.</p>}

        {source !== 'env' && (
          <form
            className="flex flex-wrap items-start gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void saveKey();
            }}
          >
            <TextField
              aria-label={source === 'stored' ? '새 API 키' : 'API 키'}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="sk-ant-..."
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
                setKeyError(null);
              }}
              error={keyError}
              leading={<KeyRound size={15} aria-hidden="true" />}
              wrapperClassName="min-w-[220px] flex-1"
            />
            <Button type="submit" variant="primary" loading={keyBusy} disabled={!key.trim()}>
              {source === 'stored' ? '바꾸기' : '저장'}
            </Button>
          </form>
        )}
        {source !== 'env' && (
          <p className="mt-2 text-subhead text-label-2">
            키는 저장하기 전에 Anthropic에 한 번 확인하고, 이 기기에만 보관해요.{' '}
            <a
              href="https://console.anthropic.com/settings/keys"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 text-accent-text underline underline-offset-2"
            >
              콘솔에서 키 만들기
              <ExternalLink size={12} aria-hidden="true" />
            </a>
          </p>
        )}
      </Group>

      <Group
        title="모델 구성"
        description="가격은 토큰 100만 개 기준이고 2026년 11월 2일 Anthropic 공개 가격표로 확인했어요. 실제 청구액은 Anthropic 콘솔에서 확인해 주세요. 지휘자는 계획과 종합을, 전문가는 실제 작업을 맡아요."
      >
        <div role="radiogroup" aria-label="모델 구성" className="space-y-2">
          {(Object.keys(MODEL_PRESETS) as ModelPreset[]).map((id) => {
            const preset = MODEL_PRESETS[id];
            const selected = settings.modelPreset === id;
            const models = preset.conductor === preset.specialist ? [preset.conductor] : [preset.conductor, preset.specialist];
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => void save({ modelPreset: id })}
                className={`press flex w-full items-start gap-3 rounded-[14px] p-3 text-left ${selected ? 'bg-[var(--accent-tint)]' : 'hover:bg-fill-4'}`}
              >
                <span
                  className={`mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full ${selected ? 'bg-accent-fill' : ''}`}
                  style={selected ? undefined : { boxShadow: 'inset 0 0 0 1.5px var(--label-3)' }}
                  aria-hidden="true"
                >
                  {selected && <span className="size-[7px] rounded-full bg-white" />}
                </span>
                <span className="min-w-0">
                  <span className="block text-callout font-semibold text-label">{preset.label}</span>
                  <span className="block text-subhead text-label-2">{preset.hint}</span>
                  {models.map((m) => (
                    <span key={m} className="block text-footnote text-label-2 tabular-nums">
                      {priceLine(m)}
                    </span>
                  ))}
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-subhead text-label-2">
          절약 구성에서도 웹 조사와 계산을 맡는 리서처, 애널리스트는 Sonnet 5.5로 실행돼요. 웹 검색은 건당 $0.01이 더 들어요.
        </p>
      </Group>

      <Group
        title="미션 비용 상한"
        description="미션 하나가 이 금액에 닿으면 새 작업을 멈춰요. 모델을 호출하기 직전에 확인하므로 이미 진행 중인 호출 때문에 조금 넘을 수 있어요."
      >
        <div className="flex flex-wrap items-start gap-4">
          <input
            type="range"
            aria-label="미션 비용 상한 슬라이더"
            min={0.1}
            max={SLIDER_MAX}
            step={0.1}
            value={Math.min(SLIDER_MAX, Number.isFinite(parsedBudget) ? parsedBudget : settings.budgetUsd)}
            onChange={(e) => setBudgetDraft(e.target.value)}
            onPointerUp={commitBudget}
            onKeyUp={commitBudget}
            className="mt-3 h-4 min-w-[180px] flex-1"
            style={{ accentColor: 'var(--accent-fill)' }}
          />
          <TextField
            aria-label="미션 비용 상한 금액 (달러)"
            inputMode="decimal"
            value={budgetValue}
            onChange={(e) => setBudgetDraft(e.target.value)}
            onBlur={commitBudget}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitBudget();
            }}
            leading={<span className="text-callout">$</span>}
            error={budgetInvalid ? `${BUDGET_MIN}달러에서 ${BUDGET_MAX}달러 사이로 적어 주세요.` : null}
            wrapperClassName="w-[132px]"
            className="tabular-nums"
          />
        </div>
        <p className="mt-1 text-footnote text-label-2 tabular-nums">지금 상한 {formatCost(settings.budgetUsd)}</p>
      </Group>

      <Group>
        <Toggle
          label="계획 먼저 확인"
          description="지휘자가 세운 계획을 보여주고, 승인한 뒤에 실행해요."
          checked={settings.reviewPlans}
          onChange={(reviewPlans) => void save({ reviewPlans })}
        />
      </Group>

      <Sheet
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="API 키를 지울까요?"
        description="이 기기에서 키를 지워요. Anthropic 계정의 키 자체가 폐기되지는 않아요."
        width={440}
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => setConfirmDelete(false)}>취소</Button>
            <Button variant="danger" loading={deleting} onClick={() => void deleteKey()}>
              키 지우기
            </Button>
          </div>
        }
      >
        <p className="text-callout text-label-2">키를 지우면 새 미션은 데모로 실행돼요.</p>
        {deleteError && (
          <p role="alert" className="mt-2 text-callout text-danger-text">
            {deleteError}
          </p>
        )}
      </Sheet>
    </div>
  );
}
