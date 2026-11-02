import { handle, readBody } from '@/lib/server/http';
import { importLegacy } from '@/lib/store/transfer';

export const dynamic = 'force-dynamic';

export const POST = handle(async (request: Request) => {
  const body = await readBody<{ todos?: unknown; memo?: unknown; schedule?: unknown }>(request);
  await importLegacy(body);
  return Response.json({ ok: true });
});
