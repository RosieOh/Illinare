'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import {
  Send, Mic, MicOff, Sparkles,
  Wrench, CheckCircle2, XCircle, ShieldAlert, AlertTriangle, Loader2,
} from 'lucide-react';
import { speakKorean } from '@/utils/speech';

// ─── 메시지 모델 ──────────────────────────────────────────────
type ApiMessage = { role: 'user' | 'assistant'; content: unknown };

type DisplayItem =
  | { kind: 'user'; id: string; text: string; timestamp: string }
  | { kind: 'jarvis'; id: string; text: string; timestamp: string; isLatest?: boolean }
  | {
      kind: 'tool';
      id: string;
      name: string;
      input: unknown;
      result: string;
      risk: 'safe' | 'confirm' | 'danger';
      status: 'ok' | 'error' | 'denied';
    }
  | {
      kind: 'pending';
      id: string;
      items: PendingItem[];
    };

interface PendingItem {
  id: string;
  name: string;
  input: unknown;
  summary: string;
  risk: 'confirm' | 'danger';
}

interface ChatResponse {
  done: boolean;
  text?: string;
  pending?: PendingItem[];
  partialResults?: Record<string, string>;
  assistantText?: string;
  messages: ApiMessage[];
  toolCalls?: Array<{
    id: string;
    name: string;
    input: unknown;
    result: string;
    risk: 'safe' | 'confirm' | 'danger';
    status: 'ok' | 'error' | 'denied';
  }>;
}

const QUICK_COMMANDS = [
  '시스템 상태 알려줘',
  '현재 볼륨은?',
  '실행중인 앱 목록',
  '서울 날씨 알려줘',
];

// ─── Web Speech API 타입 ──────────────────────────────────────
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
}
interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}
declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition: new () => SpeechRecognitionInstance;
  }
}
interface SpeechRecognitionInstance extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}

// ─── 메인 컴포넌트 ────────────────────────────────────────────
export default function ChatInterface({ onActivity }: { onActivity: (active: boolean) => void }) {
  const [items, setItems] = useState<DisplayItem[]>([
    {
      kind: 'jarvis',
      id: 'init',
      text: '일리네어 온라인. 시스템 제어 도구 22종 활성화 완료. 명령을 내려주십시오, 보스.',
      timestamp: nowStr(),
    },
  ]);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [speechError, setSpeechError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const apiMessagesRef = useRef<ApiMessage[]>([]);
  const partialResultsRef = useRef<Record<string, string>>({});
  const reduce = useReducedMotion();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
  }, [items, isThinking, reduce]);

  // ── 응답 처리 ───────────────────────────────────────────────
  const applyResponse = (data: ChatResponse) => {
    apiMessagesRef.current = data.messages ?? apiMessagesRef.current;

    setItems((prev) => {
      const next = [...prev];

      // 도구 호출 로그
      for (const tc of data.toolCalls ?? []) {
        next.push({
          kind: 'tool',
          id: tc.id,
          name: tc.name,
          input: tc.input,
          result: tc.result,
          risk: tc.risk,
          status: tc.status,
        });
      }

      // assistant 텍스트
      if (data.done && data.text) {
        next.push({
          kind: 'jarvis',
          id: `j-${Date.now()}`,
          text: data.text,
          timestamp: nowStr(),
          isLatest: true,
        });
        speakKorean(data.text);
      } else if (!data.done) {
        if (data.assistantText) {
          next.push({
            kind: 'jarvis',
            id: `j-${Date.now()}`,
            text: data.assistantText,
            timestamp: nowStr(),
          });
        }
        if (data.pending && data.pending.length > 0) {
          next.push({
            kind: 'pending',
            id: `p-${Date.now()}`,
            items: data.pending,
          });
          partialResultsRef.current = {
            ...partialResultsRef.current,
            ...(data.partialResults ?? {}),
          };
        }
      }

      // isLatest는 가장 마지막 jarvis만
      let lastJarvis = -1;
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].kind === 'jarvis') {
          lastJarvis = i;
          break;
        }
      }
      return next.map((it, i) =>
        it.kind === 'jarvis' ? { ...it, isLatest: i === lastJarvis } : it
      );
    });
  };

  // ── 메시지 전송 ─────────────────────────────────────────────
  const sendMessage = async (text: string) => {
    if (!text.trim() || isThinking) return;

    setItems((prev) => [
      ...prev,
      { kind: 'user', id: `u-${Date.now()}`, text, timestamp: nowStr() },
    ]);
    setInput('');
    setIsThinking(true);
    onActivity(true);

    apiMessagesRef.current = [
      ...apiMessagesRef.current,
      { role: 'user', content: text },
    ];
    partialResultsRef.current = {};

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessagesRef.current }),
      });
      const data = (await res.json()) as ChatResponse;
      applyResponse(data);
    } catch {
      setItems((prev) => [
        ...prev,
        {
          kind: 'jarvis',
          id: `e-${Date.now()}`,
          text: 'API 연결 오류가 발생했습니다.',
          timestamp: nowStr(),
        },
      ]);
    } finally {
      setIsThinking(false);
      setTimeout(() => onActivity(false), 2000);
    }
  };

  // ── 승인/거부 결정 후 재요청 ─────────────────────────────────
  const resolveDecisions = async (decisions: Record<string, 'approve' | 'deny'>) => {
    if (isThinking) return;
    // pending 카드 제거 (해당 ids 모두 결정된 경우만)
    setItems((prev) =>
      prev.filter((it) => {
        if (it.kind !== 'pending') return true;
        const allDecided = it.items.every((p) => p.id in decisions);
        return !allDecided;
      })
    );

    setIsThinking(true);
    onActivity(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: apiMessagesRef.current,
          decisions,
          partialResults: partialResultsRef.current,
        }),
      });
      const data = (await res.json()) as ChatResponse;
      applyResponse(data);
      // partial은 소비됨
      if (data.done) partialResultsRef.current = {};
    } catch {
      setItems((prev) => [
        ...prev,
        {
          kind: 'jarvis',
          id: `e-${Date.now()}`,
          text: '승인 처리 중 오류가 발생했습니다.',
          timestamp: nowStr(),
        },
      ]);
    } finally {
      setIsThinking(false);
      setTimeout(() => onActivity(false), 2000);
    }
  };

  // ── 음성 인식 ──────────────────────────────────────────────
  const toggleListen = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }
    const SpeechRecognition =
      typeof window !== 'undefined' &&
      (window.SpeechRecognition || window.webkitSpeechRecognition);
    if (!SpeechRecognition) {
      setSpeechError('이 브라우저는 음성 인식을 지원하지 않습니다.');
      setTimeout(() => setSpeechError(''), 3000);
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'ko-KR';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      setInput(transcript);
      sendMessage(transcript);
    };
    recognition.onerror = (e) => {
      setSpeechError(`음성 인식 오류: ${e.error}`);
      setTimeout(() => setSpeechError(''), 3000);
      setIsListening(false);
    };
    recognition.onend = () => setIsListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  };

  return (
    <div className="flex flex-col h-full" role="region" aria-label="AI 채팅 인터페이스">
      <header className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] flex-shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-accent" aria-hidden="true" />
          <span className="text-xs tracking-widest text-secondary uppercase">
            일리네어 v7.4 · macOS 제어
          </span>
        </div>
        <span className="text-[10px] text-muted uppercase tracking-widest">tool-use</span>
      </header>

      <div
        className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0"
        role="log"
        aria-live="polite"
      >
        <AnimatePresence initial={false}>
          {items.map((item) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22 }}
            >
              {item.kind === 'user' && <UserBubble item={item} />}
              {item.kind === 'jarvis' && <JarvisBubble item={item} />}
              {item.kind === 'tool' && <ToolCallChip item={item} />}
              {item.kind === 'pending' && (
                <PendingCard
                  item={item}
                  isThinking={isThinking}
                  onResolve={resolveDecisions}
                />
              )}
            </motion.div>
          ))}
        </AnimatePresence>

        <AnimatePresence>
          {isThinking && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex justify-start"
              role="status"
              aria-label="응답 생성 중"
            >
              <div className="surface rounded-md px-3 py-2 text-xs text-muted flex items-center gap-2">
                <Loader2 size={12} className="animate-spin text-accent" aria-hidden="true" />
                일리네어 처리중...
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div ref={bottomRef} />
      </div>

      {/* 입력 */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          sendMessage(input);
        }}
        className="px-4 py-3 border-t border-[var(--color-border)] flex-shrink-0"
      >
        {speechError && (
          <div className="text-xs text-[var(--color-danger)] mb-2 px-1" role="alert">
            {speechError}
          </div>
        )}
        <div className="flex gap-2 items-center">
          <button
            type="button"
            onClick={toggleListen}
            aria-pressed={isListening}
            aria-label={isListening ? '음성 인식 중지' : '음성 인식 시작'}
            className={`p-2 rounded-md border transition-colors ${
              isListening
                ? 'border-[var(--color-danger)]/60 bg-[var(--color-danger)]/10 text-[var(--color-danger)]'
                : 'border-[var(--color-border)] text-secondary hover:text-primary hover:border-[color:var(--color-accent-ring)]'
            }`}
          >
            {isListening ? (
              <MicOff size={16} aria-hidden="true" />
            ) : (
              <Mic size={16} aria-hidden="true" />
            )}
          </button>

          <div className="flex-1 relative">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={isListening ? '듣고 있습니다...' : '명령을 입력하세요...'}
              aria-label="명령 입력"
              className="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-2 text-sm text-primary placeholder-[var(--color-text-disabled)]"
              disabled={isThinking || isListening}
            />
            {isListening && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--color-danger)] flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-danger)] status-pulse" />
                녹음중
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={!input.trim() || isThinking}
            aria-label="명령 전송"
            className="p-2 rounded-md bg-[var(--color-accent-soft)] border border-[color:var(--color-accent-ring)] text-accent hover:bg-[var(--color-accent)] hover:text-[var(--color-surface-base)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Send size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="flex gap-2 mt-2 flex-wrap">
          {QUICK_COMMANDS.map((cmd) => (
            <button
              key={cmd}
              type="button"
              onClick={() => sendMessage(cmd)}
              disabled={isThinking}
              className="text-xs px-2.5 py-1 rounded-full border border-[var(--color-border)] text-muted hover:text-primary hover:border-[color:var(--color-accent-ring)] transition-colors disabled:opacity-40"
            >
              {cmd}
            </button>
          ))}
        </div>
      </form>
    </div>
  );
}

// ─── 표시용 서브 컴포넌트 ─────────────────────────────────────
function UserBubble({ item }: { item: Extract<DisplayItem, { kind: 'user' }> }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-md px-3 py-2 text-sm bg-[var(--color-accent-soft)] text-primary border border-[color:var(--color-accent-ring)]">
        <div className="text-[10px] text-muted mb-1 tracking-widest uppercase text-right">
          보스 · {item.timestamp}
        </div>
        <span>{item.text}</span>
      </div>
    </div>
  );
}

function JarvisBubble({ item }: { item: Extract<DisplayItem, { kind: 'jarvis' }> }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] surface rounded-md px-3 py-2 text-sm text-primary">
        <div className="text-[10px] text-muted mb-1 tracking-widest uppercase">
          일리네어 · {item.timestamp}
        </div>
        <span>{item.text}</span>
      </div>
    </div>
  );
}

function ToolCallChip({ item }: { item: Extract<DisplayItem, { kind: 'tool' }> }) {
  const StatusIcon =
    item.status === 'ok' ? CheckCircle2 : item.status === 'denied' ? XCircle : AlertTriangle;
  const tone =
    item.status === 'ok'
      ? 'text-[var(--color-success)]'
      : item.status === 'denied'
      ? 'text-muted'
      : 'text-[var(--color-warning)]';
  const [open, setOpen] = useState(false);
  return (
    <div className="flex justify-start">
      <button
        onClick={() => setOpen((v) => !v)}
        className="max-w-[95%] flex flex-col items-start gap-1 text-left rounded-md border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 py-2 hover:bg-[var(--color-surface-2)] transition-colors"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2 text-xs">
          <Wrench size={11} className="text-muted" aria-hidden="true" />
          <code className="text-secondary font-mono">{item.name}</code>
          <StatusIcon size={11} className={tone} aria-hidden="true" />
          <span className={`uppercase tracking-widest text-[10px] ${tone}`}>
            {item.status === 'ok' ? '실행됨' : item.status === 'denied' ? '거부됨' : '오류'}
          </span>
        </div>
        {open && (
          <div className="text-[11px] font-mono text-muted whitespace-pre-wrap break-all max-w-full">
            <div className="opacity-60">입력:</div>
            <div className="mb-1">{JSON.stringify(item.input, null, 0)}</div>
            <div className="opacity-60">결과:</div>
            <div className="text-secondary">{item.result.slice(0, 800)}</div>
          </div>
        )}
      </button>
    </div>
  );
}

function PendingCard({
  item,
  isThinking,
  onResolve,
}: {
  item: Extract<DisplayItem, { kind: 'pending' }>;
  isThinking: boolean;
  onResolve: (decisions: Record<string, 'approve' | 'deny'>) => void;
}) {
  const allApprove = () => onResolve(Object.fromEntries(item.items.map((p) => [p.id, 'approve'])));
  const allDeny = () => onResolve(Object.fromEntries(item.items.map((p) => [p.id, 'deny'])));
  return (
    <div className="flex justify-start">
      <div className="max-w-[95%] w-full rounded-md border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/5 p-3">
        <div className="flex items-center gap-2 mb-2">
          <ShieldAlert size={14} className="text-[var(--color-warning)]" aria-hidden="true" />
          <span className="text-xs tracking-widest uppercase text-[var(--color-warning)] font-medium">
            승인 필요 ({item.items.length}건)
          </span>
        </div>
        <ul className="space-y-2 mb-3">
          {item.items.map((p) => (
            <li
              key={p.id}
              className="flex items-start gap-2 px-2 py-1.5 rounded border border-[var(--color-border)] bg-[var(--color-surface-1)]"
            >
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded uppercase tracking-widest mt-0.5 ${
                  p.risk === 'danger'
                    ? 'bg-[var(--color-danger)]/15 text-[var(--color-danger)]'
                    : 'bg-[var(--color-warning)]/15 text-[var(--color-warning)]'
                }`}
              >
                {p.risk === 'danger' ? '위험' : '변경'}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-primary">{p.summary}</div>
                <code className="text-[11px] font-mono text-muted">{p.name}</code>
              </div>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <button
            onClick={allApprove}
            disabled={isThinking}
            className="flex-1 h-8 rounded-md text-xs font-medium bg-[var(--color-accent)] text-[var(--color-surface-base)] hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            모두 승인
          </button>
          <button
            onClick={allDeny}
            disabled={isThinking}
            className="flex-1 h-8 rounded-md text-xs font-medium border border-[var(--color-border)] text-secondary hover:text-primary disabled:opacity-40 transition-colors"
          >
            모두 거부
          </button>
        </div>
      </div>
    </div>
  );
}

function nowStr() {
  return new Date().toLocaleTimeString('ko-KR', { hour12: false });
}
