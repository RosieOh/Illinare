'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowUp, CornerDownRight, Loader2, Mic, Square, X } from 'lucide-react';
import { IconButton, LiquidGlass, Tooltip, spring, useToast } from '@/components/glass';
import { useApp } from '@/context/AppContext';
import { useMissions } from '@/context/MissionsContext';
import { ClientApiError } from '@/lib/client/api';
import { isActive } from '@/lib/missions/reducer';

// ─── Web Speech API 최소 타입 ─────────────────────────────────
interface RecognitionResultEvent extends Event {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}
interface RecognitionErrorEvent extends Event {
  error: string;
}
interface Recognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: RecognitionResultEvent) => void) | null;
  onerror: ((e: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}
type RecognitionCtor = new () => Recognition;

function getRecognition(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const MAX_HEIGHT = 168;

export default function Composer() {
  const { view, navigate, registerComposer, bootstrap, chromeHidden } = useApp();
  const { missions, focusedId, focus, start, followup, cancel } = useMissions();
  const toast = useToast();

  const [text, setText] = useState('');
  const [interim, setInterim] = useState('');
  const [listening, setListening] = useState(false);
  const [sending, setSending] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const glassRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<Recognition | null>(null);

  const focused = view === 'missions' && focusedId ? missions[focusedId] : undefined;
  const running = Boolean(focused && isActive(focused.status));
  const canFollowUp = Boolean(focused && !isActive(focused.status) && focused.status !== 'cancelled');
  const showStop = running && !text.trim();
  const shown = listening && interim ? `${text}${text ? ' ' : ''}${interim}` : text;

  const placeholder = listening
    ? '듣고 있어요…'
    : canFollowUp
      ? '이 미션에 이어서 지시해 보세요'
      : running
        ? '다른 일도 함께 맡길 수 있어요'
        : '무엇을 맡길까요?';

  // 어느 뷰에서든 입력창을 채우고 포커스할 수 있게 등록한다.
  const handle = useMemo(
    () => ({
      fill: (value: string) => {
        setText(value);
        requestAnimationFrame(() => {
          const el = textareaRef.current;
          if (!el) return;
          el.focus();
          el.setSelectionRange(value.length, value.length);
        });
      },
      focus: () => textareaRef.current?.focus(),
    }),
    []
  );
  useEffect(() => {
    registerComposer(handle);
    return () => registerComposer(null);
  }, [handle, registerComposer]);

  // 입력량에 맞춰 높이를 늘린다.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden';
  }, [shown]);

  // 뷰 하단 여백이 컴포저 높이를 따라가도록 알려 준다.
  useEffect(() => {
    const el = glassRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      document.documentElement.style.setProperty('--composer-h', `${Math.round(el.offsetHeight)}px`);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => recognitionRef.current?.stop(), []);

  const submit = async () => {
    const goal = text.trim();
    if (!goal || sending) return;
    recognitionRef.current?.stop();
    setSending(true);
    // 입력창은 바로 비운다. 실패하면 글을 잃지 않도록 되돌린다.
    setText('');
    try {
      if (canFollowUp && focused) {
        await followup(focused.id, goal);
      } else {
        await start(goal);
        // 오늘 화면에서 맡긴 일은 미션으로 이동해 팀이 일하는 모습을 보여 준다. 다른 화면에서는 작업 흐름을 끊지 않는다.
        if (view === 'today' || view === 'missions') navigate('missions');
      }
    } catch (err) {
      setText((cur) => cur || goal);
      toast({
        tone: 'danger',
        title: '미션을 시작하지 못했어요',
        description: err instanceof ClientApiError ? err.message : '잠시 후 다시 시도해 주세요.',
      });
    } finally {
      setSending(false);
    }
  };

  const stopFocused = async () => {
    if (!focused) return;
    try {
      await cancel(focused.id);
    } catch (err) {
      toast({
        tone: 'danger',
        title: '미션을 멈추지 못했어요',
        description: err instanceof ClientApiError ? err.message : undefined,
      });
    }
  };

  const toggleListening = () => {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const Ctor = bootstrap?.desktop ? null : getRecognition();
    const dictationHint =
      bootstrap?.platform === 'darwin'
        ? 'macOS 받아쓰기를 써 보세요. Fn 키를 두 번 누르면 시작돼요.'
        : bootstrap?.platform === 'win32'
          ? 'Windows 음성 입력을 써 보세요. Win + H를 누르면 시작돼요.'
          : '운영체제의 받아쓰기 기능을 사용해 주세요.';
    if (!Ctor) {
      toast({ tone: 'info', title: '이 환경에서는 음성 인식을 쓸 수 없어요', description: dictationHint });
      textareaRef.current?.focus();
      return;
    }

    const recognition = new Ctor();
    recognition.lang = 'ko-KR';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onresult = (e) => {
      let finalText = '';
      let partial = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (result.isFinal) finalText += result[0].transcript;
        else partial += result[0].transcript;
      }
      if (finalText) setText((cur) => `${cur}${cur ? ' ' : ''}${finalText.trim()}`);
      setInterim(partial);
    };
    recognition.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      toast({
        tone: 'warning',
        title: e.error === 'not-allowed' ? '마이크 권한이 필요해요' : '음성을 인식하지 못했어요',
        description: e.error === 'not-allowed' ? '브라우저의 마이크 권한을 허용한 뒤 다시 시도해 주세요.' : dictationHint,
      });
    };
    recognition.onend = () => {
      setListening(false);
      setInterim('');
      recognitionRef.current = null;
      textareaRef.current?.focus();
    };
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  };

  return (
    <div className="composer-anchor" style={chromeHidden ? { display: 'none' } : undefined}>
      <LiquidGlass
        ref={glassRef}
        radius={28}
        refract
        bezel={18}
        strength={80}
        interactive
        className="pointer-events-auto w-full max-w-[760px]"
      >
        <form
          className="flex items-end gap-1 p-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <IconButton
            icon={Mic}
            label={listening ? '음성 입력 멈추기' : '음성으로 입력하기'}
            aria-pressed={listening}
            onClick={toggleListening}
            className={`!size-10 !rounded-full ${listening ? '!bg-danger-fill !text-white' : ''}`}
          />

          <AnimatePresence initial={false}>
            {canFollowUp && (
              <motion.button
                type="button"
                onClick={() => focus(null)}
                initial={{ opacity: 0, scale: 0.9, width: 0 }}
                animate={{ opacity: 1, scale: 1, width: 'auto' }}
                exit={{ opacity: 0, scale: 0.9, width: 0 }}
                transition={spring.snappy}
                aria-label="후속 지시 해제하고 새 미션으로 맡기기"
                className="press mb-[5px] flex h-[30px] shrink-0 items-center gap-1 overflow-hidden rounded-full bg-[var(--accent-tint)] pr-2 pl-2.5 text-footnote font-medium whitespace-nowrap text-accent-text hover:brightness-110"
              >
                <CornerDownRight size={13} aria-hidden="true" />
                후속 지시
                <X size={12} aria-hidden="true" />
              </motion.button>
            )}
          </AnimatePresence>

          <textarea
            ref={textareaRef}
            rows={1}
            value={shown}
            onChange={(e) => {
              if (listening) recognitionRef.current?.stop();
              setText(e.target.value);
            }}
            onKeyDown={(e) => {
              // 한글 조합 중 Enter는 조합 확정이지 전송이 아니다.
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder={placeholder}
            aria-label={canFollowUp ? '후속 지시 입력' : '새 미션 입력'}
            className="max-h-[168px] min-w-0 flex-1 resize-none self-center bg-transparent px-1.5 py-1.5 text-[1.0625rem] leading-[1.45] tracking-[-0.012em] outline-none placeholder:text-label-2"
          />

          {sending ? (
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-fill text-on-accent">
              <Loader2 size={18} className="animate-spin" aria-hidden="true" />
              <span className="sr-only-live">전송 중</span>
            </span>
          ) : (
            <Tooltip content={showStop ? '미션 멈추기' : '보내기 (Enter)'}>
              <motion.button
                type={showStop ? 'button' : 'submit'}
                onClick={showStop ? () => void stopFocused() : undefined}
                disabled={!showStop && !text.trim()}
                aria-label={showStop ? '미션 멈추기' : '보내기'}
                whileTap={{ scale: 0.9 }}
                transition={spring.snappy}
                className={`relative flex size-10 shrink-0 items-center justify-center rounded-full transition-colors duration-200 ${
                  showStop
                    ? 'bg-fill-1 text-label hover:bg-fill-2'
                    : text.trim()
                      ? 'bg-accent-fill text-on-accent shadow-[0_2px_8px_-2px_rgba(0,80,200,.5),inset_0_0.5px_0_rgba(255,255,255,.4)] hover:brightness-110'
                      : 'bg-[var(--accent-tint)] text-accent-text'
                }`}
              >
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span
                    key={showStop ? 'stop' : 'send'}
                    initial={{ opacity: 0, scale: 0.5, rotate: -30 }}
                    animate={{ opacity: 1, scale: 1, rotate: 0 }}
                    exit={{ opacity: 0, scale: 0.5, rotate: 30 }}
                    transition={spring.snappy}
                    className="flex"
                  >
                    {showStop ? (
                      <Square size={14} fill="currentColor" aria-hidden="true" />
                    ) : (
                      <ArrowUp size={19} strokeWidth={2.4} aria-hidden="true" />
                    )}
                  </motion.span>
                </AnimatePresence>
              </motion.button>
            </Tooltip>
          )}
        </form>
      </LiquidGlass>
    </div>
  );
}
