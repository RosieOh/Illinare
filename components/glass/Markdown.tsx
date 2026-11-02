'use client';

import { useState, type MouseEvent, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from './Button';
import { linkCheck, type LinkCheck } from './link-check';
import { Sheet } from './Sheet';

/** 답변 속 링크. 주소를 그대로 보여 주지 않는 링크는 열기 전에 전체 주소를 확인받는다. */
function AnswerLink({ check, children }: { check: LinkCheck; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  if (!check.href) return <span>{children}</span>;
  const href = check.href;

  const onClick = (e: MouseEvent) => {
    if (!check.needsConfirm) return;
    e.preventDefault();
    setOpen(true);
  };

  return (
    <>
      <a href={href} target="_blank" rel="noopener noreferrer" title={href} onClick={onClick}>
        {children}
        {check.host && <span className="text-label-2"> ({check.host})</span>}
      </a>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="이 주소를 열까요?"
        description="AI가 만든 답변에 있는 링크예요. 주소에 내 정보가 들어 있지 않은지 확인해 주세요."
        width={520}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              취소
            </Button>
            <Button
              onClick={() => {
                window.open(href, '_blank', 'noopener,noreferrer');
                setOpen(false);
              }}
            >
              열기
            </Button>
          </>
        }
      >
        <p className="rounded-[12px] bg-fill-4 p-3 font-mono text-footnote break-all text-label select-text">{href}</p>
      </Sheet>
    </>
  );
}

/**
 * AI 응답 렌더러. react-markdown은 원시 HTML을 렌더링하지 않는다.
 * 링크는 항상 새 창에서 열리고 opener를 넘기지 않으며, http(s)와 mailto만 허용한다.
 */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={`md ${className ?? ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children: label }) => {
            const text = typeof label === 'string' ? label : Array.isArray(label) && label.every((l) => typeof l === 'string') ? label.join('') : '';
            return <AnswerLink check={linkCheck(href, text)}>{label}</AnswerLink>;
          },
          table: ({ children: rows }) => (
            <div className="md-table">
              <table>{rows}</table>
            </div>
          ),
          img: ({ alt }) => <span>{alt}</span>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
