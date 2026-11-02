import { followupMission } from '@/lib/agents/mission';
import { ApiError, handle, readBody } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export const POST = handle(async (request: Request, { params }: Context) => {
  const { id } = await params;
  const { goal } = await readBody<{ goal?: unknown }>(request, 64_000);
  if (!(await followupMission(id, goal))) throw new ApiError(404, 'not_found', '미션을 찾을 수 없어요.');
  return Response.json({ ok: true });
});
