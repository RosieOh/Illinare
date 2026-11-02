import { handle, readBody } from '@/lib/server/http';
import { getSettings, patchSettings, sanitizeSettingsPatch } from '@/lib/store/settings';

export const dynamic = 'force-dynamic';

export const GET = handle(async () => Response.json(await getSettings()));

export const PATCH = handle(async (request: Request) => {
  const patch = sanitizeSettingsPatch(await readBody<unknown>(request));
  return Response.json(await patchSettings(patch));
});
