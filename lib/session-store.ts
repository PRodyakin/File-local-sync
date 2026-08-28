export type DeviceKind = "computer" | "phone" | "tablet";

export type Peer = {
  id: string;
  name: string;
  device: DeviceKind;
  lastSeenAt: number;
};

export type SharedFile = {
  id: string;
  name: string;
  type: string;
  size: number;
  uploadedAt: number;
  uploadedBy: Pick<Peer, "id" | "name" | "device">;
  data: ArrayBuffer;
};

export type Session = {
  id: string;
  createdAt: number;
  updatedAt: number;
  text: string;
  textUpdatedAt: number;
  peers: Map<string, Peer>;
  files: Map<string, SharedFile>;
};

type SessionStore = Map<string, Session>;

declare global {
  var qrQrSessionStore: SessionStore | undefined;
}

const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const PEER_ACTIVE_MS = 12_000;
const store = globalThis.qrQrSessionStore ?? new Map<string, Session>();

globalThis.qrQrSessionStore = store;

function cleanExpiredSessions() {
  const cutoff = Date.now() - SESSION_TTL_MS;

  for (const [id, session] of store) {
    if (session.updatedAt < cutoff) {
      store.delete(id);
    }
  }
}

function makeId(length = 8) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

export function createSession() {
  cleanExpiredSessions();

  let id = makeId();
  while (store.has(id)) id = makeId();

  const now = Date.now();
  const session: Session = {
    id,
    createdAt: now,
    updatedAt: now,
    text: "",
    textUpdatedAt: now,
    peers: new Map(),
    files: new Map(),
  };

  store.set(id, session);
  return session;
}

export function getSession(id: string) {
  cleanExpiredSessions();
  return store.get(id.toUpperCase());
}

export function touchPeer(session: Session, peer: Omit<Peer, "lastSeenAt">) {
  const now = Date.now();
  const nextPeer = { ...peer, lastSeenAt: now };
  session.peers.set(peer.id, nextPeer);
  session.updatedAt = now;
  return nextPeer;
}

export function setSharedText(session: Session, text: string) {
  const now = Date.now();
  session.text = text.slice(0, 50_000);
  session.textUpdatedAt = now;
  session.updatedAt = now;
}

export function addSharedFile(
  session: Session,
  file: Omit<SharedFile, "id" | "uploadedAt">,
) {
  const now = Date.now();
  let id = makeId(10);
  while (session.files.has(id)) id = makeId(10);

  const sharedFile: SharedFile = {
    ...file,
    id,
    uploadedAt: now,
  };

  session.files.set(id, sharedFile);
  session.updatedAt = now;
  return sharedFile;
}

export function removeSharedFile(session: Session, fileId: string) {
  const removed = session.files.delete(fileId);
  if (removed) session.updatedAt = Date.now();
  return removed;
}

export function serializeSession(session: Session) {
  const peerCutoff = Date.now() - PEER_ACTIVE_MS;
  const peers = Array.from(session.peers.values())
    .filter((peer) => peer.lastSeenAt >= peerCutoff)
    .map(({ id, name, device, lastSeenAt }) => ({
      id,
      name,
      device,
      lastSeenAt,
    }));

  const files = Array.from(session.files.values())
    .map(({ id, name, type, size, uploadedAt, uploadedBy }) => ({
      id,
      name,
      type,
      size,
      uploadedAt,
      uploadedBy,
    }))
    .sort((a, b) => b.uploadedAt - a.uploadedAt);

  return {
    id: session.id,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    text: session.text,
    textUpdatedAt: session.textUpdatedAt,
    peers,
    files,
  };
}
