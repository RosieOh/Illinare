import { handle } from '@/lib/server/http';
import { listAudit } from '@/lib/store/audit';

export const dynamic = 'force-dynamic';

export const GET = handle(async (request: Request) => {
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get('limit'));
  const entries = await listAudit({
    limit: Number.isInteger(limit) && limit > 0 ? Math.min(limit, 1000) : undefined,
    missionId: url.searchParams.get('missionId'),
  });
  return Response.json({ entries });
});
