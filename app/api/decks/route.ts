import { handle, readBody } from '@/lib/server/http';
import { addDeck, listDecks } from '@/lib/store/decks';

export const dynamic = 'force-dynamic';

export const GET = handle(async () => Response.json({ decks: await listDecks() }));

export const POST = handle(async (request: Request) => {
  const body = await readBody<{ title?: unknown; slides?: unknown }>(request);
  return Response.json(await addDeck({ title: body.title, slides: body.slides }));
});
