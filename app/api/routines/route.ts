import { handle, readBody } from '@/lib/server/http';
import { addRoutine, listRoutines } from '@/lib/store/routines';

export const dynamic = 'force-dynamic';

export const GET = handle(async () => Response.json({ routines: await listRoutines() }));

export const POST = handle(async (request: Request) => {
  const body = await readBody<{ title?: unknown; goal?: unknown; icon?: unknown }>(request);
  return Response.json(await addRoutine({ title: body.title, goal: body.goal, icon: body.icon }));
});
