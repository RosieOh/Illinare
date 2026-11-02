import { handle, readBody } from '@/lib/server/http';
import { getNote, setNote } from '@/lib/store/note';

export const dynamic = 'force-dynamic';

export const GET = handle(async () => Response.json(await getNote()));

export const PUT = handle(async (request: Request) => {
  const { body } = await readBody<{ body?: unknown }>(request);
  return Response.json(await setNote(body));
});
