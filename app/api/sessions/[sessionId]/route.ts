import {
  getSession,
  serializeSession,
  setSharedText,
  touchPeer,
  type DeviceKind,
} from "../../../../lib/session-store";

type RouteContext = { params: Promise<{ sessionId: string }> };

function notFound() {
  return Response.json(
    { error: "Сессия не найдена или уже завершилась" },
    { status: 404, headers: { "cache-control": "no-store" } },
  );
}

export async function GET(_request: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  const session = getSession(sessionId);
  if (!session) return notFound();

  return Response.json(serializeSession(session), {
    headers: { "cache-control": "no-store" },
  });
}

export async function POST(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  const session = getSession(sessionId);
  if (!session) return notFound();

  const payload = (await request.json().catch(() => null)) as
    | {
        action?: "heartbeat" | "text";
        peer?: { id?: string; name?: string; device?: DeviceKind };
        text?: string;
      }
    | null;

  if (!payload) {
    return Response.json({ error: "Некорректный запрос" }, { status: 400 });
  }

  if (payload.peer?.id) {
    touchPeer(session, {
      id: payload.peer.id.slice(0, 100),
      name: (payload.peer.name || "Устройство").slice(0, 80),
      device: ["computer", "phone", "tablet"].includes(
        payload.peer.device || "",
      )
        ? payload.peer.device!
        : "phone",
    });
  }

  if (payload.action === "text" && typeof payload.text === "string") {
    setSharedText(session, payload.text);
  }

  return Response.json(serializeSession(session), {
    headers: { "cache-control": "no-store" },
  });
}

