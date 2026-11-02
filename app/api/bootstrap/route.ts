import { BRAND, type Bootstrap } from '@/lib/contracts';
import { handle } from '@/lib/server/http';
import { dataDir } from '@/lib/store/json';
import { apiKeyInfo } from '@/lib/store/secrets';
import { getSettings } from '@/lib/store/settings';

export const dynamic = 'force-dynamic';

export const GET = handle(async () => {
  const [settings, key] = await Promise.all([getSettings(), apiKeyInfo()]);
  const platform = process.platform === 'win32' || process.platform === 'darwin' ? process.platform : 'linux';
  const body: Bootstrap = {
    brand: BRAND,
    platform,
    mode: key.hasApiKey ? 'live' : 'demo',
    hasApiKey: key.hasApiKey,
    apiKeySource: key.source,
    apiKeyHint: key.hint,
    settings,
    dataDir: dataDir(),
    desktop: process.env.ILLIONAIRE_DESKTOP === '1',
  };
  return Response.json(body);
});
