import { cancelOrDeleteMission, getMissionView } from '@/lib/agents/mission';
import { ApiError, handle } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export const GET = handle(async (_request: Request, { params }: Context) => {
  const { id } = await params;
  const view = await getMissionView(id);
  if (!view) throw new ApiError(404, 'not_found', '미션을 찾을 수 없어요.');
  return Response.json(view);
});

/** 진행 중이면 취소하고, 끝났으면 삭제한다. */
export const DELETE = handle(async (_request: Request, { params }: Context) => {
  const { id } = await params;
  if (!(await cancelOrDeleteMission(id))) throw new ApiError(404, 'not_found', '미션을 찾을 수 없어요.');
  return Response.json({ ok: true });
});
