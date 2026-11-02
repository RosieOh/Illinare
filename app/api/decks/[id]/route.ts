import { handle } from '@/lib/server/http';
import { getDeck, removeDeck } from '@/lib/store/decks';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_request: Request, { params }: Ctx) => {
  const { id } = await params;
  return Response.json(await getDeck(id));
});

export const DELETE = handle(async (_request: Request, { params }: Ctx) => {
  const { id } = await params;
  await removeDeck(id);
  return Response.json({ ok: true });
});
