import { createMission, listMissionSummaries } from '@/lib/agents/mission';
import { handle, readBody } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

export const GET = handle(async () => {
  return Response.json({ missions: await listMissionSummaries() });
});

/** 즉시 id를 돌려주고 미션은 백그라운드에서 달린다. 클라이언트는 목표 문장만 보낼 수 있다. */
export const POST = handle(async (request: Request) => {
  const { goal } = await readBody<{ goal?: unknown }>(request, 64_000);
  const id = await createMission(goal);
  return Response.json({ id }, { status: 201 });
});
