import { collectSnapshot } from '@/lib/platform/stats';
import { handle } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

export const GET = handle(async () => Response.json(await collectSnapshot()));
