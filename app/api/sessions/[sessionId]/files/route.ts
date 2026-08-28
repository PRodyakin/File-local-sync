import {
  addSharedFile,
  getSession,
  serializeSession,
  touchPeer,
  type DeviceKind,
} from "../../../../../lib/session-store";

type RouteContext = { params: Promise<{ sessionId: string }> };

const MAX_FILE_SIZE = 200 * 1024 * 1024;
const MAX_SESSION_SIZE = 400 * 1024 * 1024;

export async function POST(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  const session = getSession(sessionId);

  if (!session) {
    return Response.json({ error: "Сессия не найдена" }, { status: 404 });
  }

  const size = Number(request.headers.get("content-length") || "0");
  if (size > MAX_FILE_SIZE) {
    return Response.json(
      { error: "Для MVP максимальный размер файла — 200 МБ" },
      { status: 413 },
    );
  }

  const url = new URL(request.url);
  const name = (url.searchParams.get("name") || "Файл").slice(0, 220);
  const type = (url.searchParams.get("type") || "application/octet-stream").slice(
    0,
    120,
  );
  const peerId = (request.headers.get("x-peer-id") || "unknown").slice(0, 100);
  const encodedPeerName = request.headers.get("x-peer-name") || "Устройство";
  let peerName = "Устройство";
  try {
    peerName = decodeURIComponent(encodedPeerName).slice(0, 80);
  } catch {
    peerName = "Устройство";
  }
  const requestedDevice = request.headers.get("x-peer-device") || "phone";
  const device: DeviceKind = ["computer", "phone", "tablet"].includes(
    requestedDevice,
  )
    ? (requestedDevice as DeviceKind)
    : "phone";
  const data = await request.arrayBuffer();

  if (data.byteLength > MAX_FILE_SIZE) {
    return Response.json(
      { error: "Для MVP максимальный размер файла — 200 МБ" },
      { status: 413 },
    );
  }

  const sessionSize = Array.from(session.files.values()).reduce(
    (total, file) => total + file.size,
    0,
  );
  if (sessionSize + data.byteLength > MAX_SESSION_SIZE) {
    return Response.json(
      { error: "В одной сессии можно хранить до 400 МБ файлов" },
      { status: 413 },
    );
  }

  const peer = touchPeer(session, {
    id: peerId,
    name: peerName,
    device,
  });
  const file = addSharedFile(session, {
    name,
    type,
    size: data.byteLength,
    uploadedBy: {
      id: peer.id,
      name: peer.name,
      device: peer.device,
    },
    data,
  });

  return Response.json(
    { file: { ...file, data: undefined }, session: serializeSession(session) },
    { status: 201, headers: { "cache-control": "no-store" } },
  );
}
