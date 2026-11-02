import { handle, readBody } from '@/lib/server/http';
import { patchEvent, removeEvent } from '@/lib/store/events';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handle(async (request: Request, { params }: Ctx) => {
  const { id } = await params;
  return Response.json(await patchEvent(id, await readBody<Record<string, unknown>>(request)));
});

export const DELETE = handle(async (_request: Request, { params }: Ctx) => {
  const { id } = await params;
  await removeEvent(id);
  return Response.json({ ok: true });
});
