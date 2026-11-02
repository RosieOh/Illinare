'use client';

import { useEffect } from 'react';

/** 앱 전체가 그려지지 않을 때의 최후 화면. 프로바이더 밖이라 기본 토큰만 쓴다. */
export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex h-full items-center justify-center bg-surface p-6 text-center">
      <div className="max-w-sm">
        <h1 className="text-title2 text-label">화면을 그리지 못했어요</h1>
        <p className="mt-2 text-callout text-label-2">
          진행 중이던 미션과 저장된 데이터는 그대로예요. 다시 시도해도 같은 화면이 나오면 앱을 다시 실행해 주세요.
        </p>
        <button
          type="button"
          onClick={() => unstable_retry()}
          className="press mt-5 h-10 rounded-xl bg-accent-fill px-4 text-callout font-medium text-on-accent"
        >
          다시 시도
        </button>
      </div>
    </main>
  );
}
