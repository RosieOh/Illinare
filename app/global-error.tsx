'use client';

import './globals.css';

/** 루트 레이아웃까지 실패했을 때. html과 body를 직접 그려야 한다. */
export default function GlobalError({ unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return (
    <html lang="ko">
      <body className="flex h-full items-center justify-center bg-surface p-6 text-center">
        <div className="max-w-sm">
          <h1 className="text-title2 text-label">앱을 시작하지 못했어요</h1>
          <p className="mt-2 text-callout text-label-2">저장된 데이터는 안전해요. 다시 시도하거나 앱을 다시 실행해 주세요.</p>
          <button
            type="button"
            onClick={() => unstable_retry()}
            className="press mt-5 h-10 rounded-xl bg-accent-fill px-4 text-callout font-medium text-on-accent"
          >
            다시 시도
          </button>
        </div>
      </body>
    </html>
  );
}
