import { handle } from '@/lib/server/http';
import { removeMemory } from '@/lib/store/memory';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export const DELETE = handle(async (_request: Request, { params }: Ctx) => {
  const { id } = await params;
  await removeMemory(id);
  return Response.json({ ok: true });
});
