import { handle, readBody } from '@/lib/server/http';
import { addTask, listTasks } from '@/lib/store/tasks';

export const dynamic = 'force-dynamic';

export const GET = handle(async () => Response.json({ tasks: await listTasks() }));

export const POST = handle(async (request: Request) => {
  const body = await readBody<{ text?: unknown; priority?: unknown; due?: unknown }>(request);
  return Response.json(await addTask({ text: body.text, priority: body.priority, due: body.due }));
});
