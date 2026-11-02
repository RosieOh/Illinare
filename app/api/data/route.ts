import { purgeAllMissions } from '@/lib/agents/mission';
import { handle } from '@/lib/server/http';
import { deleteAllData } from '@/lib/store/transfer';

export const dynamic = 'force-dynamic';

export const DELETE = handle(async () => {
  await purgeAllMissions();
  await deleteAllData();
  return Response.json({ ok: true });
});
