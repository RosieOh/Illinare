import { handle, readBody } from '@/lib/server/http';
import { addEvent, listEvents } from '@/lib/store/events';

export const dynamic = 'force-dynamic';

export const GET = handle(async (request: Request) => {
  const url = new URL(request.url);
  const events = await listEvents({ from: url.searchParams.get('from'), to: url.searchParams.get('to') });
  return Response.json({ events });
});

export const POST = handle(async (request: Request) => {
  const body = await readBody<{ title?: unknown; date?: unknown; time?: unknown; durationMin?: unknown; kind?: unknown }>(
    request
  );
  return Response.json(
    await addEvent({
      title: body.title,
      date: body.date,
      time: body.time,
      durationMin: body.durationMin,
      kind: body.kind,
    })
  );
});
