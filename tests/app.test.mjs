import assert from "node:assert/strict";
import test from "node:test";

const workerUrl = new URL("../dist/server/index.js", import.meta.url);
workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
const { default: worker } = await import(workerUrl.href);

const env = {
  ASSETS: {
    fetch: async () => new Response("Not found", { status: 404 }),
  },
};

const ctx = {
  waitUntil() {},
  passThroughOnException() {},
};

function request(path, init) {
  return worker.fetch(new Request(`http://localhost${path}`, init), env, ctx);
}

test("renders the finished QR·QR product shell", async () => {
  const response = await request("/", {
    headers: { accept: "text/html" },
  });

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="ru">/i);
  assert.match(html, /<title>QR·QR — обмен файлами рядом<\/title>/i);
  assert.match(html, /Создаём безопасную сессию/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("creates a session and synchronizes peers, text, and a file", async () => {
  const createdResponse = await request("/api/sessions", { method: "POST" });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  assert.match(created.id, /^[A-Z2-9]{8}$/);

  const heartbeatResponse = await request(`/api/sessions/${created.id}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "heartbeat",
      peer: { id: "desktop-1", name: "Компьютер", device: "computer" },
    }),
  });
  const heartbeat = await heartbeatResponse.json();
  assert.equal(heartbeat.peers.length, 1);
  assert.equal(heartbeat.peers[0].name, "Компьютер");

  const textResponse = await request(`/api/sessions/${created.id}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "text",
      text: "Текст с телефона",
      peer: { id: "phone-1", name: "Телефон", device: "phone" },
    }),
  });
  const textState = await textResponse.json();
  assert.equal(textState.text, "Текст с телефона");
  assert.equal(textState.peers.length, 2);

  const payload = new TextEncoder().encode("hello from phone");
  const uploadResponse = await request(
    `/api/sessions/${created.id}/files?name=${encodeURIComponent("заметка.txt")}&type=text%2Fplain`,
    {
      method: "POST",
      headers: {
        "content-type": "text/plain",
        "x-peer-id": "phone-1",
        "x-peer-name": encodeURIComponent("Телефон"),
        "x-peer-device": "phone",
      },
      body: payload,
    },
  );
  assert.equal(uploadResponse.status, 201);
  const upload = await uploadResponse.json();
  assert.equal(upload.session.files.length, 1);
  assert.equal(upload.session.files[0].name, "заметка.txt");

  const fileId = upload.session.files[0].id;
  const downloadResponse = await request(
    `/api/sessions/${created.id}/files/${fileId}`,
  );
  assert.equal(downloadResponse.status, 200);
  assert.equal(await downloadResponse.text(), "hello from phone");
  assert.match(
    downloadResponse.headers.get("content-disposition") ?? "",
    /attachment/,
  );

  const deleteResponse = await request(
    `/api/sessions/${created.id}/files/${fileId}`,
    { method: "DELETE" },
  );
  assert.equal(deleteResponse.status, 204);

  const stateResponse = await request(`/api/sessions/${created.id}`);
  const finalState = await stateResponse.json();
  assert.equal(finalState.files.length, 0);
  assert.equal(finalState.text, "Текст с телефона");
});

test("rejects unknown sessions and oversized uploads", async () => {
  const missingResponse = await request("/api/sessions/AAAAAAAA");
  assert.equal(missingResponse.status, 404);

  const createdResponse = await request("/api/sessions", { method: "POST" });
  const created = await createdResponse.json();
  const oversizedResponse = await request(
    `/api/sessions/${created.id}/files?name=huge.bin`,
    {
      method: "POST",
      headers: { "content-length": String(201 * 1024 * 1024) },
      body: new Uint8Array([1]),
    },
  );
  assert.equal(oversizedResponse.status, 413);
});

