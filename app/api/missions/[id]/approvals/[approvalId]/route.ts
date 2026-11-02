import { decideApproval } from '@/lib/agents/mission';
import type { ApprovalDecision } from '@/lib/contracts';
import { ApiError, handle, readBody } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string; approvalId: string }> };

export const POST = handle(async (request: Request, { params }: Context) => {
  const { id, approvalId } = await params;
  const { decision, remember } = await readBody<{ decision?: ApprovalDecision; remember?: unknown }>(request, 4_000);
  if (decision !== 'approve' && decision !== 'deny') {
    throw new ApiError(400, 'invalid_decision', '승인 또는 거부를 선택해 주세요.');
  }
  const ok = await decideApproval(id, approvalId, decision, remember === true);
  if (!ok) throw new ApiError(404, 'not_found', '이미 처리되었거나 없는 승인 요청이에요.');
  return Response.json({ ok: true });
});
