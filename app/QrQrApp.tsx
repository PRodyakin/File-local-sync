"use client";

import {
  Archive,
  Check,
  Clipboard,
  Copy,
  Download,
  File,
  FileText,
  Image as ImageIcon,
  Laptop,
  Link2,
  LoaderCircle,
  Music,
  RefreshCw,
  Send,
  Share2,
  ShieldCheck,
  Smartphone,
  Trash2,
  UploadCloud,
  Video,
  Wifi,
  X,
} from "lucide-react";
import { QRCodeCanvas } from "qrcode.react";
import {
  type ChangeEvent,
  type DragEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type DeviceKind = "computer" | "phone" | "tablet";

type Peer = {
  id: string;
  name: string;
  device: DeviceKind;
  lastSeenAt: number;
};

type SharedFile = {
  id: string;
  name: string;
  type: string;
  size: number;
  uploadedAt: number;
  uploadedBy: Pick<Peer, "id" | "name" | "device">;
};

type SessionData = {
  id: string;
  createdAt: number;
  updatedAt: number;
  text: string;
  textUpdatedAt: number;
  peers: Peer[];
  files: SharedFile[];
};

type Phase = "starting" | "ready" | "error";

function detectDevice(): DeviceKind {
  const ua = navigator.userAgent.toLowerCase();
  if (/ipad|tablet/.test(ua)) return "tablet";
  if (/iphone|android|mobile/.test(ua)) return "phone";
  return "computer";
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} МБ`;
  }
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} ГБ`;
}

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat("ru", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

function iconForFile(type: string, name: string) {
  const normalized = `${type} ${name}`.toLowerCase();
  if (normalized.includes("image")) return ImageIcon;
  if (normalized.includes("video")) return Video;
  if (normalized.includes("audio")) return Music;
  if (/zip|rar|7z|tar|archive/.test(normalized)) return Archive;
  if (/text|pdf|doc|txt|rtf|md/.test(normalized)) return FileText;
  return File;
}

function getSessionIdFromLocation() {
  return new URLSearchParams(window.location.search).get("session")?.toUpperCase();
}

function getPeerName(device: DeviceKind) {
  if (device === "computer") return "Компьютер";
  if (device === "tablet") return "Планшет";
  return "Телефон";
}

function createPeerId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readJson<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => null)) as
    | (T & { error?: string })
    | null;
  if (!response.ok) {
    throw new Error(data?.error || "Не удалось связаться с устройством");
  }
  return data as T;
}

export function QrQrApp() {
  const [phase, setPhase] = useState<Phase>("starting");
  const [error, setError] = useState("");
  const [session, setSession] = useState<SessionData | null>(null);
  const [peer, setPeer] = useState<Peer | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [activeTab, setActiveTab] = useState<"files" | "text">("files");
  const [sharedText, setSharedText] = useState("");
  const [uploadState, setUploadState] = useState<{
    name: string;
    progress: number;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState<"link" | "text" | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const textSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestTextVersion = useRef(0);
  const sessionRef = useRef<SessionData | null>(null);
  const peerRef = useRef<Peer | null>(null);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    peerRef.current = peer;
  }, [peer]);

  const applySession = useCallback((next: SessionData) => {
    setSession(next);
    sessionRef.current = next;

    if (
      next.textUpdatedAt > latestTextVersion.current &&
      document.activeElement !== textAreaRef.current
    ) {
      setSharedText(next.text);
      latestTextVersion.current = next.textUpdatedAt;
    }
  }, []);

  const heartbeat = useCallback(async () => {
    const currentSession = sessionRef.current;
    const currentPeer = peerRef.current;
    if (!currentSession || !currentPeer) return;

    const response = await fetch(`/api/sessions/${currentSession.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "heartbeat", peer: currentPeer }),
    });
    applySession(await readJson<SessionData>(response));
  }, [applySession]);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      try {
        const device = detectDevice();
        const nextPeer: Peer = {
          id: createPeerId(),
          name: getPeerName(device),
          device,
          lastSeenAt: Date.now(),
        };
        const requestedSession = getSessionIdFromLocation();
        const hostFromUrl = new URLSearchParams(window.location.search).get("host") === "1";
        let nextSession: SessionData;

        if (requestedSession) {
          const response = await fetch(`/api/sessions/${requestedSession}`, {
            cache: "no-store",
          });
          nextSession = await readJson<SessionData>(response);
          setIsHost(hostFromUrl);
        } else {
          const response = await fetch("/api/sessions", { method: "POST" });
          nextSession = await readJson<SessionData>(response);
          setIsHost(true);
          window.history.replaceState(
            null,
            "",
            `/?session=${nextSession.id}&host=1`,
          );
        }

        if (cancelled) return;
        setPeer(nextPeer);
        peerRef.current = nextPeer;
        setSharedText(nextSession.text);
        latestTextVersion.current = nextSession.textUpdatedAt;
        applySession(nextSession);
        setPhase("ready");

        const joined = await fetch(`/api/sessions/${nextSession.id}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "heartbeat", peer: nextPeer }),
        });
        applySession(await readJson<SessionData>(joined));
      } catch (caught) {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : "Не удалось начать сессию");
        setPhase("error");
      }
    }

    start();
    return () => {
      cancelled = true;
    };
  }, [applySession]);

  useEffect(() => {
    if (phase !== "ready") return;

    const timer = window.setInterval(() => {
      heartbeat().catch(() => {
        setNotice("Связь прервалась. Проверяем сеть…");
      });
    }, 1_500);

    return () => window.clearInterval(timer);
  }, [heartbeat, phase]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3_500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const joinUrl = useMemo(() => {
    if (!session || typeof window === "undefined") return "";
    return `${window.location.origin}/?session=${session.id}`;
  }, [session]);

  const otherPeers = useMemo(
    () => session?.peers.filter((item) => item.id !== peer?.id) ?? [],
    [peer?.id, session?.peers],
  );

  const hasLocalhostAddress =
    typeof window !== "undefined" &&
    ["localhost", "127.0.0.1"].includes(window.location.hostname);

  const copy = async (value: string, type: "link" | "text") => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(type);
      window.setTimeout(() => setCopied(null), 1_800);
    } catch {
      setNotice("Не получилось скопировать автоматически");
    }
  };

  const shareLink = async () => {
    if (!joinUrl) return;
    if (navigator.share) {
      await navigator.share({ title: "QR·QR", url: joinUrl }).catch(() => undefined);
    } else {
      await copy(joinUrl, "link");
    }
  };

  const saveText = (value: string) => {
    setSharedText(value);
    if (textSaveTimer.current) clearTimeout(textSaveTimer.current);
    textSaveTimer.current = setTimeout(async () => {
      const currentSession = sessionRef.current;
      const currentPeer = peerRef.current;
      if (!currentSession || !currentPeer) return;

      try {
        const response = await fetch(`/api/sessions/${currentSession.id}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "text", text: value, peer: currentPeer }),
        });
        const next = await readJson<SessionData>(response);
        latestTextVersion.current = next.textUpdatedAt;
        applySession(next);
      } catch {
        setNotice("Текст пока не отправился — проверьте сеть");
      }
    }, 450);
  };

  const uploadOne = useCallback(
    (file: globalThis.File) =>
      new Promise<void>((resolve, reject) => {
        const currentSession = sessionRef.current;
        const currentPeer = peerRef.current;
        if (!currentSession || !currentPeer) {
          reject(new Error("Нет активной сессии"));
          return;
        }

        if (file.size > 200 * 1024 * 1024) {
          reject(new Error(`${file.name}: максимум 200 МБ`));
          return;
        }

        const query = new URLSearchParams({
          name: file.name,
          type: file.type || "application/octet-stream",
        });
        const request = new XMLHttpRequest();
        request.open(
          "POST",
          `/api/sessions/${currentSession.id}/files?${query.toString()}`,
        );
        request.setRequestHeader("x-peer-id", currentPeer.id);
        request.setRequestHeader("x-peer-name", encodeURIComponent(currentPeer.name));
        request.setRequestHeader("x-peer-device", currentPeer.device);
        request.upload.onprogress = (event) => {
          const progress = event.lengthComputable
            ? Math.round((event.loaded / event.total) * 100)
            : 0;
          setUploadState({ name: file.name, progress });
        };
        request.onload = () => {
          if (request.status >= 200 && request.status < 300) {
            const payload = JSON.parse(request.responseText) as {
              session: SessionData;
            };
            applySession(payload.session);
            resolve();
          } else {
            const payload = JSON.parse(request.responseText || "{}") as {
              error?: string;
            };
            reject(new Error(payload.error || `Не удалось отправить ${file.name}`));
          }
        };
        request.onerror = () => reject(new Error(`Не удалось отправить ${file.name}`));
        request.send(file);
      }),
    [applySession],
  );

  const uploadFiles = useCallback(
    async (files: globalThis.File[]) => {
      if (!files.length) return;
      try {
        for (const file of files) await uploadOne(file);
        setNotice(files.length === 1 ? "Файл готов к скачиванию" : "Файлы готовы к скачиванию");
      } catch (caught) {
        setNotice(caught instanceof Error ? caught.message : "Не удалось отправить файл");
      } finally {
        setUploadState(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [uploadOne],
  );

  const onFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    uploadFiles(Array.from(event.target.files ?? []));
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    uploadFiles(Array.from(event.dataTransfer.files));
  };

  const deleteFile = async (fileId: string) => {
    if (!session) return;
    const response = await fetch(`/api/sessions/${session.id}/files/${fileId}`, {
      method: "DELETE",
    });
    if (response.ok) {
      setSession((current) =>
        current
          ? { ...current, files: current.files.filter((file) => file.id !== fileId) }
          : current,
      );
      setNotice("Файл удалён из сессии");
    }
  };

  if (phase === "starting") {
    return (
      <main className="state-screen">
        <div className="brand-mark" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
        <LoaderCircle className="state-spinner" aria-hidden="true" />
        <p>Создаём безопасную сессию…</p>
      </main>
    );
  }

  if (phase === "error") {
    return (
      <main className="state-screen">
        <div className="error-symbol">
          <Wifi aria-hidden="true" />
          <X aria-hidden="true" />
        </div>
        <h1>Не получилось подключиться</h1>
        <p>{error}</p>
        <button className="primary-button" onClick={() => window.location.assign("/")}>
          <RefreshCw size={18} aria-hidden="true" />
          Создать новую сессию
        </button>
      </main>
    );
  }

  if (!session || !peer) return null;

  return (
    <main className="app-shell">
      <header className="topbar">
        <button
          className="brand"
          onClick={() => window.location.assign("/")}
          aria-label="QR·QR — новая сессия"
        >
          <span className="brand-mark brand-mark-small" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </span>
          <span>QR·QR</span>
        </button>
        <div className="privacy-pill">
          <ShieldCheck size={16} aria-hidden="true" />
          Только ваша Wi‑Fi сеть
        </div>
      </header>

      <div className={`workspace ${isHost ? "workspace-with-qr" : "workspace-connected"}`}>
        {isHost && (
          <aside className="connect-panel">
            <div className="eyebrow">
              <span>01</span>
              Подключите телефон
            </div>
            <h1>
              Наведите камеру
              <br />
              <span>и передавайте.</span>
            </h1>
            <p className="lead">
              Никаких регистраций и облаков. Компьютер и телефон должны быть в одной сети.
            </p>

            <div className="qr-card">
              <div className="qr-code-wrap">
                <QRCodeCanvas
                  value={joinUrl}
                  size={220}
                  level="M"
                  marginSize={1}
                  bgColor="#ffffff"
                  fgColor="#161914"
                  title="QR-код для подключения телефона"
                />
                <span className="qr-center-mark" aria-hidden="true">
                  Q
                </span>
              </div>
              <div className="qr-caption">
                <span className="live-dot" />
                Сессия <strong>{session.id}</strong>
              </div>
            </div>

            {hasLocalhostAddress && (
              <div className="address-warning">
                <Wifi size={18} aria-hidden="true" />
                <span>
                  QR сейчас содержит localhost. Откройте на компьютере сетевой адрес,
                  который показан при запуске.
                </span>
              </div>
            )}

            <div className="link-row">
              <Link2 size={18} aria-hidden="true" />
              <span>{joinUrl}</span>
              <button onClick={() => copy(joinUrl, "link")} aria-label="Скопировать ссылку">
                {copied === "link" ? <Check size={18} /> : <Copy size={18} />}
              </button>
              <button onClick={shareLink} aria-label="Поделиться ссылкой">
                <Share2 size={18} />
              </button>
            </div>
          </aside>
        )}

        <section className="transfer-panel">
          <div className="connection-bar">
            <div className={`device-orbit ${otherPeers.length ? "is-connected" : ""}`}>
              <span className="device-bubble computer-bubble">
                <Laptop size={20} aria-hidden="true" />
              </span>
              <span className="orbit-line" />
              <span className="device-bubble phone-bubble">
                <Smartphone size={20} aria-hidden="true" />
              </span>
            </div>
            <div className="connection-copy">
              <strong>
                {otherPeers.length
                  ? "Устройства на связи"
                  : isHost
                    ? "Ждём телефон"
                    : "Подключение установлено"}
              </strong>
              <span>
                {otherPeers.length
                  ? `${otherPeers.length + 1} устройства в сессии`
                  : isHost
                    ? "Отсканируйте QR-код"
                    : "Можно отправлять файлы и текст"}
              </span>
            </div>
            <div className={`status-chip ${otherPeers.length || !isHost ? "online" : "waiting"}`}>
              <span />
              {otherPeers.length || !isHost ? "В сети" : "Ожидание"}
            </div>
          </div>

          {!isHost && (
            <div className="mobile-session-heading">
              <div>
                <span>Сессия {session.id}</span>
                <h1>Что отправим?</h1>
              </div>
              <div className="phone-network-mark">
                <Wifi size={21} aria-hidden="true" />
              </div>
            </div>
          )}

          <div className="tabs" role="tablist" aria-label="Тип обмена">
            <button
              className={activeTab === "files" ? "active" : ""}
              onClick={() => setActiveTab("files")}
              role="tab"
              aria-selected={activeTab === "files"}
            >
              <UploadCloud size={19} aria-hidden="true" />
              Файлы
              {session.files.length > 0 && <span>{session.files.length}</span>}
            </button>
            <button
              className={activeTab === "text" ? "active" : ""}
              onClick={() => setActiveTab("text")}
              role="tab"
              aria-selected={activeTab === "text"}
            >
              <Clipboard size={18} aria-hidden="true" />
              Текст
              {sharedText && <span className="text-indicator" />}
            </button>
          </div>

          {activeTab === "files" ? (
            <div className="tab-content" role="tabpanel">
              <div
                className={`dropzone ${isDragging ? "dragging" : ""} ${uploadState ? "uploading" : ""}`}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setIsDragging(true);
                }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={() => setIsDragging(false)}
                onDrop={onDrop}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  onChange={onFileInput}
                  aria-label="Выбрать файлы"
                />
                {uploadState ? (
                  <>
                    <div className="upload-progress-ring" style={{ "--progress": uploadState.progress } as React.CSSProperties}>
                      <span>{uploadState.progress}%</span>
                    </div>
                    <div>
                      <strong>Отправляем {uploadState.name}</strong>
                      <p>Не закрывайте эту вкладку</p>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="drop-icon">
                      <Send size={24} aria-hidden="true" />
                    </span>
                    <div>
                      <strong>{isDragging ? "Отпускайте — поймаем" : "Перетащите файлы сюда"}</strong>
                      <p>или выберите с устройства · до 200 МБ</p>
                    </div>
                    <button
                      className="primary-button choose-button"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      Выбрать файлы
                    </button>
                  </>
                )}
              </div>

              <div className="files-section">
                <div className="section-heading">
                  <h2>В этой сессии</h2>
                  <span>{session.files.length ? `${session.files.length} ${session.files.length === 1 ? "файл" : "файла"}` : "Пока пусто"}</span>
                </div>
                {session.files.length ? (
                  <ul className="file-list">
                    {session.files.map((file) => {
                      const FileIcon = iconForFile(file.type, file.name);
                      return (
                        <li key={file.id}>
                          <span className="file-icon">
                            <FileIcon size={22} aria-hidden="true" />
                          </span>
                          <div className="file-copy">
                            <strong title={file.name}>{file.name}</strong>
                            <span>
                              {formatBytes(file.size)} · {file.uploadedBy.name.toLowerCase()} · {formatTime(file.uploadedAt)}
                            </span>
                          </div>
                          <a
                            className="icon-button download-button"
                            href={`/api/sessions/${session.id}/files/${file.id}`}
                            download={file.name}
                            aria-label={`Скачать ${file.name}`}
                          >
                            <Download size={19} aria-hidden="true" />
                          </a>
                          <button
                            className="icon-button delete-button"
                            onClick={() => deleteFile(file.id)}
                            aria-label={`Удалить ${file.name}`}
                          >
                            <Trash2 size={17} aria-hidden="true" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <div className="empty-state">
                    <div className="empty-stack" aria-hidden="true">
                      <span />
                      <span />
                      <File size={24} />
                    </div>
                    <strong>Отправленные файлы появятся здесь</strong>
                    <p>Они доступны только участникам этой локальной сессии.</p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="tab-content text-panel" role="tabpanel">
              <div className="section-heading text-heading">
                <div>
                  <h2>Общий текст</h2>
                  <span>Изменения появляются на втором устройстве автоматически</span>
                </div>
                <button
                  className="secondary-button"
                  onClick={() => copy(sharedText, "text")}
                  disabled={!sharedText}
                >
                  {copied === "text" ? <Check size={17} /> : <Copy size={17} />}
                  {copied === "text" ? "Скопировано" : "Скопировать"}
                </button>
              </div>
              <div className="textarea-wrap">
                <textarea
                  ref={textAreaRef}
                  value={sharedText}
                  onChange={(event) => saveText(event.target.value)}
                  onBlur={() => heartbeat().catch(() => undefined)}
                  placeholder="Вставьте ссылку, адрес, заметку или любой текст…"
                  aria-label="Общий текст"
                  maxLength={50_000}
                />
                <div className="textarea-footer">
                  <span>{sharedText.length.toLocaleString("ru")} / 50 000</span>
                  {sharedText && (
                    <button onClick={() => saveText("")}>Очистить</button>
                  )}
                </div>
              </div>
              <div className="text-tip">
                <Clipboard size={20} aria-hidden="true" />
                <div>
                  <strong>Как общий буфер обмена</strong>
                  <span>Напишите здесь на телефоне — скопируйте на компьютере, или наоборот.</span>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      <footer>
        <span>
          <ShieldCheck size={15} aria-hidden="true" />
          Файлы не сохраняются после завершения сессии
        </span>
        <span>Сессия автоматически закроется через 2 часа бездействия</span>
      </footer>

      {notice && <div className="toast" role="status">{notice}</div>}
    </main>
  );
}
