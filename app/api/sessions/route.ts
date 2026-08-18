import { createSession, serializeSession } from "../../../lib/session-store";

export async function POST() {
  const session = createSession();

  return Response.json(serializeSession(session), {
    status: 201,
    headers: { "cache-control": "no-store" },
  });
}

