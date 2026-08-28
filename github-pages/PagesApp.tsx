import {
  Archive,
  Check,
  Clipboard,
  Copy,
  Download,
  File,
  FileText,
  Image as ImageIcon,
  Info,
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
import { DataConnection, Peer as PeerClient } from "peerjs";
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
type Phase = "starting" | "ready" | "error";

type Device = {
  id: string;
  name: string;
  device: DeviceKind;
};

type FileMeta = {
  id: string;
  name: string;
  type: string;
  size: number;
  uploadedAt: number;
  uploadedBy: Pick<Device, "id" | "name" | "device">;
};

type SharedFile = FileMeta & { url: string };

type WireMessage =
  | { type: "hello"; device: Device }
  | { type: "snapshot"; text: string }
  | { type: "text"; text: string }
  | { type: "file-start"; file: FileMeta }
  | { type: "file-chunk"; id: string; data: ArrayBuffer }
  | { type: "file-end"; id: string }
  | { type: "file-delete"; id: string };

type IncomingFile = {
  file: FileMeta;
  chunks: ArrayBuffer[];
  received: number;
};

const MAX_FILE_SIZE = 200 * 1024 * 1024;
const CHUNK_SIZE = 64 * 1024;
const MAX_BUFFERED_AMOUNT = 4 * 1024 * 1024;

const peerOptions = {
  debug: 1,
  config: {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    iceTransportPolicy: "all" as const,
  },
};

function detectDevice(): DeviceKind {
  const ua = navigator.userAgent.toLowerCase();
  if (/ipad|tablet/.test(ua)) return "tablet";
  if (/iphone|android|mobile/.test(ua)) return "phone";
  return "computer";
}

function getDeviceName(device: DeviceKind) {
  if (device === "computer") return "Компьютер";
  if (device === "tablet") return "Планшет";
  return "Телефон";
}

function randomId(length = 10) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function uniqueId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now()}-${randomId(8)}`;
}

function peerIdForSession(sessionId: string) {
  return `qrqr-${sessionId.toLowerCase()}`;
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

function normalizeBuffer(value: unknown) {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
  }
  return null;
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function PagesApp() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const initialSession = params.get("session")?.toUpperCase() || "";
  const initialHost = params.get("host") === "1" || !initialSession;

  const [phase, setPhase] = useState<Phase>("starting");
  const [error, setError] = useState("");
  const [sessionId] = useState(initialSession || randomId());
  const [isHost] = useState(initialHost);
  const [self] = useState<Device>(() => {
    const kind = detectDevice();
    return { id: uniqueId(), name: getDeviceName(kind), device: kind };
  });
  const [remote, setRemote] = useState<Device | null>(null);
  const [activeTab, setActiveTab] = useState<"files" | "text">("files");
  const [sharedText, setSharedText] = useState("");
  const [files, setFiles] = useState<SharedFile[]>([]);
  const [transfer, setTransfer] = useState<{
    name: string;
    progress: number;
    direction: "send" | "receive";
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState<"link" | "text" | null>(null);

  const connectionsRef = useRef<DataConnection[]>([]);
  const incomingRef = useRef(new Map<string, IncomingFile>());
  const filesRef = useRef<SharedFile[]>([]);
  const textRef = useRef("");
  const textTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    textRef.current = sharedText;
  }, [sharedText]);

  const joinUrl = useMemo(() => {
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    url.searchParams.set("session", sessionId);
    return url.toString();
  }, [sessionId]);

  const broadcast = useCallback((message: WireMessage) => {
    for (const connection of connectionsRef.current) {
      if (connection.open) void connection.send(message);
    }
  }, []);

  const removeFile = useCallback((fileId: string, tellRemote = true) => {
    setFiles((current) => {
      const target = current.find((file) => file.id === fileId);
      if (target) URL.revokeObjectURL(target.url);
      return current.filter((file) => file.id !== fileId);
    });
    if (tellRemote) broadcast({ type: "file-delete", id: fileId });
    setNotice("Файл удалён из сессии");
  }, [broadcast]);

  const handleWireMessage = useCallback((connection: DataConnection, raw: unknown) => {
    if (!raw || typeof raw !== "object" || !("type" in raw)) return;
    const message = raw as WireMessage;

    if (message.type === "hello") {
      setRemote(message.device);
      if (isHost) void connection.send({ type: "snapshot", text: textRef.current });
      return;
    }

    if (message.type === "snapshot" || message.type === "text") {
      textRef.current = message.text.slice(0, 50_000);
      setSharedText(textRef.current);
      return;
    }

    if (message.type === "file-start") {
      incomingRef.current.set(message.file.id, {
        file: message.file,
        chunks: [],
        received: 0,
      });
      setTransfer({ name: message.file.name, progress: 0, direction: "receive" });
      return;
    }

    if (message.type === "file-chunk") {
      const incoming = incomingRef.current.get(message.id);
      const buffer = normalizeBuffer(message.data);
      if (!incoming || !buffer) return;
      incoming.chunks.push(buffer);
      incoming.received += buffer.byteLength;
      const progress = Math.min(99, Math.round((incoming.received / incoming.file.size) * 100));
      setTransfer({ name: incoming.file.name, progress, direction: "receive" });
      return;
    }

    if (message.type === "file-end") {
      const incoming = incomingRef.current.get(message.id);
      if (!incoming) return;
      const blob = new Blob(incoming.chunks, { type: incoming.file.type });
      const nextFile: SharedFile = {
        ...incoming.file,
        url: URL.createObjectURL(blob),
      };
      incomingRef.current.delete(message.id);
      setFiles((current) => [nextFile, ...current.filter((file) => file.id !== nextFile.id)]);
      setTransfer(null);
      setNotice("Файл готов к скачиванию");
      return;
    }

    if (message.type === "file-delete") removeFile(message.id, false);
  }, [isHost, removeFile]);

  const attachConnection = useCallback((connection: DataConnection, device: Device) => {
    connectionsRef.current = [connection];

    const connectionTimeout = window.setTimeout(() => {
      if (!connection.open) {
        connection.close();
        setError("Не удалось соединить устройства. Обновите обе страницы и попробуйте ещё раз.");
        setPhase("error");
      }
    }, 12_000);

    connection.on("open", () => {
      window.clearTimeout(connectionTimeout);
      connectionsRef.current = [connection];
      void connection.send({ type: "hello", device });
      if (isHost) void connection.send({ type: "snapshot", text: textRef.current });
      setPhase("ready");
    });
    connection.on("data", (data) => handleWireMessage(connection, data));
    connection.on("close", () => {
      window.clearTimeout(connectionTimeout);
      connectionsRef.current = connectionsRef.current.filter((item) => item !== connection);
      setRemote(null);
      setNotice("Второе устройство отключилось");
    });
    connection.on("error", () => {
      window.clearTimeout(connectionTimeout);
      setNotice("Ошибка прямого соединения");
    });
  }, [handleWireMessage, isHost]);

  useEffect(() => {
    if (isHost && !initialSession) {
      const url = new URL(window.location.href);
      url.search = "";
      url.searchParams.set("session", sessionId);
      url.searchParams.set("host", "1");
      window.history.replaceState(null, "", url);
    }

    const peer = isHost
      ? new PeerClient(peerIdForSession(sessionId), peerOptions)
      : new PeerClient(peerOptions);

    peer.on("open", () => {
      if (isHost) {
        setPhase("ready");
        return;
      }
      const connection = peer.connect(peerIdForSession(sessionId), {
        reliable: true,
        serialization: "binary",
      });
      attachConnection(connection, self);
    });

    peer.on("connection", (connection) => {
      if (!isHost) {
        connection.close();
        return;
      }
      for (const current of connectionsRef.current) current.close();
      attachConnection(connection, self);
    });

    peer.on("error", (caught) => {
      if (caught.type === "peer-unavailable") {
        setError("Сессия не найдена. Откройте QR·QR на компьютере и отсканируйте новый QR-код.");
      } else if (caught.type === "unavailable-id") {
        setError("Эта сессия уже открыта в другой вкладке.");
      } else {
        setError("Не удалось установить прямое соединение. Проверьте интернет и Wi‑Fi.");
      }
      setPhase("error");
    });

    return () => {
      if (textTimerRef.current) clearTimeout(textTimerRef.current);
      for (const connection of connectionsRef.current) connection.close();
      peer.destroy();
      for (const file of filesRef.current) URL.revokeObjectURL(file.url);
    };
  }, [attachConnection, initialSession, isHost, self, sessionId]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3_500);
    return () => window.clearTimeout(timer);
  }, [notice]);

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
    if (navigator.share) {
      await navigator.share({ title: "QR·QR", url: joinUrl }).catch(() => undefined);
    } else {
      await copy(joinUrl, "link");
    }
  };

  const saveText = (value: string) => {
    const next = value.slice(0, 50_000);
    textRef.current = next;
    setSharedText(next);
    if (textTimerRef.current) clearTimeout(textTimerRef.current);
    textTimerRef.current = setTimeout(() => broadcast({ type: "text", text: next }), 180);
  };

  const waitForBuffer = async (connection: DataConnection) => {
    while (connection.open && connection.dataChannel.bufferedAmount > MAX_BUFFERED_AMOUNT) {
      await delay(20);
    }
  };

  const uploadFiles = useCallback(async (selected: globalThis.File[]) => {
    const connections = connectionsRef.current.filter((connection) => connection.open);
    if (!connections.length || !self) {
      setNotice("Сначала подключите второе устройство");
      return;
    }

    try {
      for (const selectedFile of selected) {
        if (selectedFile.size > MAX_FILE_SIZE) {
          throw new Error(`${selectedFile.name}: максимум 200 МБ`);
        }

        const meta: FileMeta = {
          id: uniqueId(),
          name: selectedFile.name,
          type: selectedFile.type || "application/octet-stream",
          size: selectedFile.size,
          uploadedAt: Date.now(),
          uploadedBy: self,
        };

        setFiles((current) => [{ ...meta, url: URL.createObjectURL(selectedFile) }, ...current]);
        for (const connection of connections) await connection.send({ type: "file-start", file: meta });

        let sent = 0;
        while (sent < selectedFile.size) {
          const chunk = await selectedFile.slice(sent, sent + CHUNK_SIZE).arrayBuffer();
          for (const connection of connections) {
            await waitForBuffer(connection);
            await connection.send({ type: "file-chunk", id: meta.id, data: chunk });
          }
          sent += chunk.byteLength;
          setTransfer({
            name: selectedFile.name,
            progress: Math.min(99, Math.round((sent / selectedFile.size) * 100)),
            direction: "send",
          });
        }

        for (const connection of connections) await connection.send({ type: "file-end", id: meta.id });
      }
      setNotice(selected.length === 1 ? "Файл отправлен" : "Файлы отправлены");
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Не удалось отправить файл");
    } finally {
      setTransfer(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [self]);

  const onFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    void uploadFiles(Array.from(event.target.files ?? []));
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    void uploadFiles(Array.from(event.dataTransfer.files));
  };

  const resetSession = () => {
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    window.location.assign(url);
  };

  if (phase === "starting") {
    return (
      <main className="state-screen">
        <div className="brand-mark" aria-hidden="true"><span /><span /><span /><span /></div>
        <LoaderCircle className="state-spinner" aria-hidden="true" />
        <p>Создаём прямое соединение…</p>
      </main>
    );
  }

  if (phase === "error") {
    return (
      <main className="state-screen">
        <div className="error-symbol"><Wifi aria-hidden="true" /><X aria-hidden="true" /></div>
        <h1>Не получилось подключиться</h1>
        <p>{error}</p>
        <button className="primary-button" onClick={resetSession}>
          <RefreshCw size={18} aria-hidden="true" />Создать новую сессию
        </button>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={resetSession} aria-label="QR·QR — новая сессия">
          <span className="brand-mark brand-mark-small" aria-hidden="true"><span /><span /><span /><span /></span>
          <span>QR·QR</span>
        </button>
        <div className="privacy-pill"><ShieldCheck size={16} aria-hidden="true" />Прямое P2P-соединение</div>
      </header>

      <div className={`workspace ${isHost ? "workspace-with-qr" : "workspace-connected"}`}>
        {isHost && (
          <aside className="connect-panel">
            <div className="eyebrow"><span>01</span>Подключите телефон</div>
            <h1>Наведите камеру<br /><span>и передавайте.</span></h1>
            <p className="lead">Без регистрации и установки. Откройте ссылку на телефоне, пока эта вкладка активна.</p>

            <div className="qr-card">
              <div className="qr-code-wrap">
                <QRCodeCanvas value={joinUrl} size={220} level="M" marginSize={1} bgColor="#ffffff" fgColor="#161914" title="QR-код для подключения телефона" />
                <span className="qr-center-mark" aria-hidden="true">Q</span>
              </div>
              <div className="qr-caption"><span className="live-dot" />Сессия <strong>{sessionId}</strong></div>
            </div>

            <div className="link-row">
              <Link2 size={18} aria-hidden="true" /><span>{joinUrl}</span>
              <button onClick={() => copy(joinUrl, "link")} aria-label="Скопировать ссылку">{copied === "link" ? <Check size={18} /> : <Copy size={18} />}</button>
              <button onClick={shareLink} aria-label="Поделиться ссылкой"><Share2 size={18} /></button>
            </div>

            <div className="pages-note">
              <Info size={18} aria-hidden="true" />
              <span>Для знакомства устройств используется бесплатный PeerJS-сервер. Содержимое файлов и текста ему не передаётся.</span>
            </div>
          </aside>
        )}

        <section className="transfer-panel">
          <div className="connection-bar">
            <div className={`device-orbit ${remote ? "is-connected" : ""}`}>
              <span className="device-bubble computer-bubble"><Laptop size={20} aria-hidden="true" /></span><span className="orbit-line" /><span className="device-bubble phone-bubble"><Smartphone size={20} aria-hidden="true" /></span>
            </div>
            <div className="connection-copy">
              <strong>{remote ? "Устройства на связи" : isHost ? "Ждём телефон" : "Подключаемся…"}</strong>
              <span>{remote ? <><em>{remote.name}</em> подключён напрямую</> : isHost ? "Отсканируйте QR-код" : "Не закрывайте вкладку"}</span>
            </div>
            <div className={`status-chip ${remote ? "online" : "waiting"}`}><span />{remote ? "В сети" : "Ожидание"}</div>
          </div>

          {!isHost && <div className="mobile-session-heading"><div><span>Сессия {sessionId}</span><h1>Что отправим?</h1></div><div className="phone-network-mark"><Wifi size={21} aria-hidden="true" /></div></div>}

          <div className="tabs" role="tablist" aria-label="Тип обмена">
            <button className={activeTab === "files" ? "active" : ""} onClick={() => setActiveTab("files")} role="tab" aria-selected={activeTab === "files"}><UploadCloud size={19} aria-hidden="true" />Файлы{files.length > 0 && <span>{files.length}</span>}</button>
            <button className={activeTab === "text" ? "active" : ""} onClick={() => setActiveTab("text")} role="tab" aria-selected={activeTab === "text"}><Clipboard size={18} aria-hidden="true" />Текст{sharedText && <span className="text-indicator" />}</button>
          </div>

          {activeTab === "files" ? (
            <div className="tab-content" role="tabpanel">
              <div className={`dropzone ${isDragging ? "dragging" : ""} ${transfer ? "uploading" : ""}`} onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setIsDragging(false)} onDrop={onDrop}>
                <input ref={fileInputRef} type="file" multiple onChange={onFileInput} aria-label="Выбрать файлы" />
                {transfer ? (
                  <><div className="upload-progress-ring" style={{ "--progress": transfer.progress } as React.CSSProperties}><span>{transfer.progress}%</span></div><div><strong>{transfer.direction === "send" ? "Отправляем" : "Получаем"} {transfer.name}</strong><p>Не закрывайте эту вкладку</p></div></>
                ) : (
                  <><span className="drop-icon"><Send size={24} aria-hidden="true" /></span><div><strong>{isDragging ? "Отпускайте — поймаем" : "Перетащите файлы сюда"}</strong><p>или выберите с устройства · до 200 МБ</p></div><button className="primary-button choose-button" onClick={() => fileInputRef.current?.click()}>Выбрать файлы</button></>
                )}
              </div>

              <div className="files-section">
                <div className="section-heading"><h2>В этой вкладке</h2><span>{files.length ? `${files.length} ${files.length === 1 ? "файл" : "файла"}` : "Пока пусто"}</span></div>
                {files.length ? (
                  <ul className="file-list">
                    {files.map((file) => {
                      const FileIcon = iconForFile(file.type, file.name);
                      return <li key={file.id}><span className="file-icon"><FileIcon size={22} aria-hidden="true" /></span><div className="file-copy"><strong title={file.name}>{file.name}</strong><span>{formatBytes(file.size)} · {file.uploadedBy.name.toLowerCase()} · {formatTime(file.uploadedAt)}</span></div><a className="icon-button download-button" href={file.url} download={file.name} aria-label={`Скачать ${file.name}`}><Download size={19} aria-hidden="true" /></a><button className="icon-button delete-button" onClick={() => removeFile(file.id)} aria-label={`Удалить ${file.name}`}><Trash2 size={17} aria-hidden="true" /></button></li>;
                    })}
                  </ul>
                ) : (
                  <div className="empty-state"><div className="empty-stack" aria-hidden="true"><span /><span /><File size={24} /></div><strong>Отправленные файлы появятся здесь</strong><p>Они находятся только в памяти открытых вкладок.</p></div>
                )}
              </div>
            </div>
          ) : (
            <div className="tab-content text-panel" role="tabpanel">
              <div className="section-heading text-heading"><div><h2>Общий текст</h2><span>Изменения появляются на втором устройстве автоматически</span></div><button className="secondary-button" onClick={() => copy(sharedText, "text")} disabled={!sharedText}>{copied === "text" ? <Check size={17} /> : <Copy size={17} />}{copied === "text" ? "Скопировано" : "Скопировать"}</button></div>
              <div className="textarea-wrap"><textarea ref={textAreaRef} value={sharedText} onChange={(event) => saveText(event.target.value)} placeholder="Вставьте ссылку, адрес, заметку или любой текст…" aria-label="Общий текст" maxLength={50_000} /><div className="textarea-footer"><span>{sharedText.length.toLocaleString("ru")} / 50 000</span>{sharedText && <button onClick={() => saveText("")}>Очистить</button>}</div></div>
              <div className="text-tip"><Clipboard size={20} aria-hidden="true" /><div><strong>Как общий буфер обмена</strong><span>Напишите на телефоне — скопируйте на компьютере, или наоборот.</span></div></div>
            </div>
          )}
        </section>
      </div>

      <footer><span><ShieldCheck size={15} aria-hidden="true" />Файлы не загружаются на сервер</span><span>Закрытие вкладки завершает сессию</span></footer>
      {notice && <div className="toast" role="status">{notice}</div>}
    </main>
  );
}
