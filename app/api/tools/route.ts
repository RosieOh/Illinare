import { handle } from '@/lib/server/http';
import { getSettings } from '@/lib/store/settings';
import { toolInfos } from '@/lib/tools/policy';

export const dynamic = 'force-dynamic';

export const GET = handle(async () => Response.json({ tools: toolInfos(await getSettings()) }));
