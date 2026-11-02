import { handle, readBody } from '@/lib/server/http';
import { addMemory, listMemory } from '@/lib/store/memory';

export const dynamic = 'force-dynamic';

export const GET = handle(async () => Response.json({ items: await listMemory() }));

export const POST = handle(async (request: Request) => {
  const { text } = await readBody<{ text?: unknown }>(request);
  return Response.json(await addMemory(text, 'user'));
});
