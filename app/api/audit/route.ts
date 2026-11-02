import { handle } from '@/lib/server/http';
import { listAudit } from '@/lib/store/audit';

export const dynamic = 'force-dynamic';

export const GET = handle(async (request: Request) => {
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get('limit'));
  // 내보내기는 전체를 준다. 모든 행동이 기록에 남는다는 약속은 꺼내 볼 때도 지켜져야 한다.
  const all = url.searchParams.get('all') === '1';
  const entries = await listAudit({
    limit: all ? Number.POSITIVE_INFINITY : Number.isInteger(limit) && limit > 0 ? Math.min(limit, 1000) : undefined,
    missionId: url.searchParams.get('missionId'),
  });
  return Response.json({ entries });
});
