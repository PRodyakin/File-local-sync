import {
  getSession,
  removeSharedFile,
} from "../../../../../../lib/session-store";

type RouteContext = {
  params: Promise<{ sessionId: string; fileId: string }>;
};

function safeDownloadName(name: string) {
  return name.replace(/[^\x20-\x7E]/g, "_").replace(/[\r\n"\\]/g, "_");
}

export async function GET(_request: Request, context: RouteContext) {
  const { sessionId, fileId } = await context.params;
  const session = getSession(sessionId);
  const file = session?.files.get(fileId);

  if (!file) {
    return Response.json({ error: "Файл не найден" }, { status: 404 });
  }

  return new Response(file.data, {
    headers: {
      "content-type": file.type || "application/octet-stream",
      "content-length": String(file.size),
      "content-disposition": `attachment; filename="${safeDownloadName(file.name)}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "cache-control": "no-store",
    },
  });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { sessionId, fileId } = await context.params;
  const session = getSession(sessionId);

  if (!session) {
    return Response.json({ error: "Сессия не найдена" }, { status: 404 });
  }

  if (!removeSharedFile(session, fileId)) {
    return Response.json({ error: "Файл не найден" }, { status: 404 });
  }

  return new Response(null, { status: 204 });
}
