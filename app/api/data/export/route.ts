import { handle } from '@/lib/server/http';
import { exportAll } from '@/lib/store/transfer';

export const dynamic = 'force-dynamic';

export const GET = handle(async () => Response.json(await exportAll()));
