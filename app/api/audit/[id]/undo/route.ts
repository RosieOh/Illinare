import { ApiError, handle } from '@/lib/server/http';
import { undoAudit } from '@/lib/tools/execute';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (_request: Request, { params }: Ctx) => {
  const { id } = await params;
  try {
    const { message } = await undoAudit(id);
    return Response.json({ ok: true, message });
  } catch (err) {
    // undoAudit의 오류 메시지는 사용자에게 보여주도록 작성되어 있다.
    throw new ApiError(409, 'undo_failed', err instanceof Error ? err.message : '되돌리지 못했어요.');
  }
});
