import { openMissionFeed } from '@/lib/agents/mission';
import type { MissionEvent } from '@/lib/contracts';
import { ApiError, handle } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

const HEARTBEAT_MS = 15_000;

type Context = { params: Promise<{ id: string }> };

function parseSeq(value: string | null): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * SSE. since 또는 Last-Event-ID 이후의 이벤트를 재생한 뒤 실시간으로 이어 보낸다.
 * 연결이 끊겨도 구독만 해제한다. 미션은 계속 달린다.
 */
export const GET = handle(async (request: Request, { params }: Context) => {
  const { id } = await params;
  const url = new URL(request.url);
  const since = Math.max(parseSeq(url.searchParams.get('since')), parseSeq(request.headers.get('last-event-id')));
  const feed = await openMissionFeed(id);
  if (!feed) throw new ApiError(404, 'not_found', '미션을 찾을 수 없어요.');

  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const subscription: { stop?: () => void } = {};

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keep-alive\n\n'));
        } catch {
          cleanup();
        }
      }, HEARTBEAT_MS);

      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        subscription.stop?.();
        request.signal.removeEventListener('abort', cleanup);
      };
      request.signal.addEventListener('abort', cleanup);

      const close = () => {
        cleanup();
        try {
          controller.close();
        } catch {
          /* 이미 닫힘 */
        }
      };

      const send = (event: MissionEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`));
        } catch {
          cleanup();
          return;
        }
        if (event.type === 'mission.finished') close();
      };

      subscription.stop = feed.attach(since, send);
      // 재생 중에 닫혔으면 attach가 돌려준 구독 해제가 아직 호출되지 않았다.
      if (closed) subscription.stop();
      else if (feed.isTerminal()) close();
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
});
