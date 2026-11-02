import { handle } from '@/lib/server/http';
import { removeRoutine } from '@/lib/store/routines';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export const DELETE = handle(async (_request: Request, { params }: Ctx) => {
  const { id } = await params;
  await removeRoutine(id);
  return Response.json({ ok: true });
});
