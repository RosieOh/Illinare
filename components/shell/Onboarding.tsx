'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ExternalLink, KeyRound, ShieldCheck, Undo2, Waypoints } from 'lucide-react';
import { BRAND } from '@/lib/contracts';
import { Button, Sheet, TextField, spring, useToast } from '@/components/glass';
import { useApp } from '@/context/AppContext';
import { useMissions } from '@/context/MissionsContext';
import { api, ClientApiError } from '@/lib/client/api';
import BrandMark from './BrandMark';
import TeamDroplets from '@/components/mission/TeamDroplets';

const FIRST_GOAL_LIVE = '내 컴퓨터 상태를 점검하고, 눈여겨볼 점이 있으면 알려 줘';
const FIRST_GOAL_DEMO = '이번 주 시장 동향을 조사해 3장짜리 브리핑 자료로 만들어 줘';

type Step = 'welcome' | 'name' | 'key' | 'trust' | 'first';
const ORDER: Step[] = ['welcome', 'name', 'key', 'trust', 'first'];

export default function Onboarding() {
  const { status, settings } = useApp();
  if (status !== 'ready' || settings.onboarded) return null;
  return <OnboardingFlow />;
}

function OnboardingFlow() {
  const { bootstrap, patchSettings, reload, navigate, settings } = useApp();
  const { start } = useMissions();
  const toast = useToast();

  const [step, setStep] = useState<Step>('welcome');
  const [name, setName] = useState(settings.displayName);
  const [key, setKey] = useState('');
  const [keyError, setKeyError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [keyDone, setKeyDone] = useState(false);
  const [starting, setStarting] = useState(false);

  const usingEnvKey = bootstrap?.apiKeySource === 'env';
  const live = keyDone || Boolean(bootstrap?.hasApiKey);
  const firstGoal = live ? FIRST_GOAL_LIVE : FIRST_GOAL_DEMO;

  const verifyKey = async () => {
    const trimmed = key.trim();
    if (!trimmed) {
      setKeyError('API 키를 붙여 넣어 주세요.');
      return;
    }
    if (!trimmed.startsWith('sk-ant-')) {
      setKeyError('Anthropic API 키는 sk-ant-로 시작해요. 키를 다시 확인해 주세요.');
      return;
    }
    setVerifying(true);
    setKeyError(null);
    try {
      await api.put('/api/settings/api-key', { key: trimmed });
      setKey('');
      setKeyDone(true);
      setStep('trust');
      void reload();
    } catch (err) {
      setKeyError(err instanceof ClientApiError ? err.message : '키를 확인하지 못했어요. 인터넷 연결을 확인해 주세요.');
    } finally {
      setVerifying(false);
    }
  };

  const finish = async (runFirstMission: boolean) => {
    setStarting(true);
    await patchSettings({ onboarded: true, displayName: name.trim() });
    if (!runFirstMission) return;
    try {
      await start(firstGoal);
      navigate('missions');
    } catch (err) {
      toast({
        tone: 'danger',
        title: '첫 미션을 시작하지 못했어요',
        description: err instanceof ClientApiError ? err.message : '입력창에서 다시 맡겨 주세요.',
      });
    }
  };

  const index = ORDER.indexOf(step);

  return (
    <Sheet open onClose={() => undefined} dismissible={false} ariaLabel={`${BRAND.name} 시작하기`} width={500} bare glass="clear">
      <div className="flex min-h-[440px] flex-col p-7 max-sm:min-h-[400px] max-sm:p-5">
        <div className="mb-6 flex items-center gap-1.5" role="img" aria-label={`전체 ${ORDER.length}단계 중 ${index + 1}단계`}>
          {ORDER.map((s, i) => (
            <span
              key={s}
              className="h-1 flex-1 rounded-full transition-colors duration-300"
              style={{ background: i <= index ? 'var(--accent)' : 'var(--fill-2)' }}
            />
          ))}
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 14 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10, transition: { duration: 0.09 } }}
            transition={spring.gentle}
            className="flex flex-1 flex-col"
          >
            {step === 'welcome' && (
              <>
                <BrandMark size={52} className="text-accent" />
                <h1 className="mt-5 text-title1 text-label">목표만 말하면, AI 팀이 나눠서 처리해요</h1>
                <p className="mt-3 text-body text-label-2">
                  {BRAND.name}은 내 컴퓨터에서 실행돼요. 전문 에이전트들이 일을 나눠 맡고, 파일이나 설정을 바꾸는 일은 먼저 물어봐요.
                </p>
                <div className="flex flex-1 items-center justify-center py-4" aria-hidden="true">
                  <TeamDroplets size={176} decorative />
                </div>
                <div className="flex justify-end">
                  <Button variant="primary" size="lg" className="!rounded-full" onClick={() => setStep('name')}>
                    시작하기
                  </Button>
                </div>
              </>
            )}

            {step === 'name' && (
              <form
                className="flex flex-1 flex-col"
                onSubmit={(e) => {
                  e.preventDefault();
                  setStep('key');
                }}
              >
                <h1 className="text-title2 text-label">어떻게 불러 드릴까요?</h1>
                <p className="mt-2 text-body text-label-2">화면과 답변에서 이 이름을 써요. 비워 두면 이름 없이 이야기할게요.</p>
                <TextField
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="이름 또는 별명"
                  aria-label="이름"
                  maxLength={30}
                  wrapperClassName="mt-5"
                />
                <div className="mt-auto flex items-center justify-between pt-8">
                  <Button variant="plain" onClick={() => setStep('welcome')}>
                    이전
                  </Button>
                  <Button type="submit" variant="primary" size="lg" className="!rounded-full">
                    다음
                  </Button>
                </div>
              </form>
            )}

            {step === 'key' && (
              <form
                className="flex flex-1 flex-col"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (usingEnvKey) setStep('trust');
                  else void verifyKey();
                }}
              >
                <h1 className="text-title2 text-label">Anthropic API 키를 연결해 주세요</h1>
                {usingEnvKey ? (
                  <p className="mt-2 text-body text-label-2">
                    환경 변수에 설정된 키를 찾았어요. 그대로 사용할게요{bootstrap?.apiKeyHint ? ` (${bootstrap.apiKeyHint})` : ''}.
                  </p>
                ) : (
                  <>
                    <p className="mt-2 text-body text-label-2">
                      내 키로 Claude를 호출하고, 요금은 내 Anthropic 계정에 청구돼요. 키는 이 기기에만 저장돼요.
                    </p>
                    <TextField
                      autoFocus
                      type="password"
                      value={key}
                      onChange={(e) => {
                        setKey(e.target.value);
                        setKeyError(null);
                      }}
                      placeholder="sk-ant-…"
                      aria-label="Anthropic API 키"
                      autoComplete="off"
                      spellCheck={false}
                      leading={<KeyRound size={15} aria-hidden="true" />}
                      error={keyError}
                      wrapperClassName="mt-5"
                    />
                    <a
                      href="https://console.anthropic.com/settings/keys"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 inline-flex items-center gap-1 self-start text-subhead"
                    >
                      console.anthropic.com에서 키 만들기
                      <ExternalLink size={12} aria-hidden="true" />
                    </a>
                  </>
                )}
                <div className="mt-auto flex items-center justify-between gap-2 pt-8">
                  <Button variant="plain" onClick={() => setStep('name')}>
                    이전
                  </Button>
                  <span className="flex items-center gap-2">
                    {!usingEnvKey && (
                      <Button variant="secondary" size="lg" className="!rounded-full" onClick={() => setStep('trust')}>
                        데모로 둘러보기
                      </Button>
                    )}
                    <Button type="submit" variant="primary" size="lg" loading={verifying} className="!rounded-full">
                      {usingEnvKey ? '다음' : '키 확인'}
                    </Button>
                  </span>
                </div>
              </form>
            )}

            {step === 'trust' && (
              <>
                <h1 className="text-title2 text-label">통제권은 항상 내게 있어요</h1>
                <ul className="mt-5 space-y-4">
                  <TrustRow icon={ShieldCheck} title="바꾸는 일은 먼저 물어봐요">
                    파일 쓰기와 삭제, 앱 종료처럼 상태를 바꾸는 작업은 승인한 뒤에만 실행돼요.
                  </TrustRow>
                  <TrustRow icon={Undo2} title="파일 변경은 되돌릴 수 있어요">
                    모든 작업이 활동 기록에 남고, 파일 변경은 기록에서 되돌릴 수 있어요.
                  </TrustRow>
                  <TrustRow icon={Waypoints} title="어디로 나가는지 분명해요">
                    데이터는 이 기기에 저장돼요. 미션 내용은 답변을 만들기 위해 Anthropic API로 전송돼요.
                  </TrustRow>
                </ul>
                <div className="mt-auto flex items-center justify-between pt-8">
                  <Button variant="plain" onClick={() => setStep('key')}>
                    이전
                  </Button>
                  <Button variant="primary" size="lg" className="!rounded-full" onClick={() => setStep('first')}>
                    다음
                  </Button>
                </div>
              </>
            )}

            {step === 'first' && (
              <>
                <h1 className="text-title2 text-label">{name.trim() ? `${name.trim()}님, ` : ''}첫 미션을 맡겨 볼까요?</h1>
                <p className="mt-2 text-body text-label-2">
                  {live
                    ? '가볍게 시스템 점검부터 시작해 보세요. 팀이 일하는 모습을 실시간으로 볼 수 있어요.'
                    : '데모 모드에서는 준비된 시나리오가 재생돼요. 실제 AI 호출이나 파일 변경은 일어나지 않아요.'}
                </p>
                <p className="mt-5 rounded-[16px] bg-fill-3 p-4 text-body font-medium text-label">{firstGoal}</p>
                <div className="mt-auto flex items-center justify-between gap-2 pt-8">
                  <Button variant="plain" disabled={starting} onClick={() => void finish(false)}>
                    나중에 할게요
                  </Button>
                  <Button variant="primary" size="lg" loading={starting} className="!rounded-full" onClick={() => void finish(true)}>
                    이 미션 시작
                  </Button>
                </div>
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </Sheet>
  );
}

function TrustRow({ icon: Icon, title, children }: { icon: typeof ShieldCheck; title: string; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--accent-tint)] text-accent-text">
        <Icon size={18} aria-hidden="true" />
      </span>
      <div>
        <div className="text-callout font-semibold text-label">{title}</div>
        <div className="mt-0.5 text-callout text-label-2">{children}</div>
      </div>
    </li>
  );
}
