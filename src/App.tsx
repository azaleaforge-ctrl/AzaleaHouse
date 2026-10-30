import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AiSettings,
  AppSettings,
  GenState,
  Message,
  ProfileId,
  RuntimeStatus,
  View,
} from "./types";
import type { Attachment } from "./types";
import type { UpdateStatus } from "./types";
import type { UpdateInfo, UpdateProgressEvent, StoredMessage, ChatStartPayload } from "./lib/tauri";
import {
  FALLBACK_VERSION,
  MAX_FILE_BYTES,
  models,
  profileById,
  TEXT_EXTENSIONS,
  IMAGE_EXTENSIONS,
} from "./data/mock";
import { clockNow, uid } from "./lib/format";
import { readAppVersion } from "./lib/tauri";
import {
  invokeChatCancel,
  invokeChatStart,
  invokeRuntimeStatus,
  invokeSaveConversation,
  invokeLoadSettings,
  invokeSaveSettings,
  invokeEnsureMemoryDir,
  invokeMemoryPath,
  invokeListConversations,
  invokeLoadConversation,
  invokeDeleteConversation,
  invokeOpenMemoryFolder,
  invokePickMemoryParentFolder,
  invokeSetCustomPath,
  invokeBackupMemory,
  invokeCheckUpdate,
  invokeDownloadUpdate,
  invokeCancelDownload,
  listenUpdateProgress,
  invokeUnloadModel,
  invokeLoadModel,
  listenChatEvents,
} from "./lib/tauri";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { BackgroundLayer } from "./components/BackgroundLayer";
import { Sidebar } from "./components/Sidebar";
import { ChatView } from "./components/ChatView";
import { HistoryView } from "./components/HistoryView";
import { SettingsPanel } from "./components/SettingsPanel";
import { SettingsScreen } from "./components/SettingsScreen";
import { VersionCenter } from "./components/VersionCenter";
import { ComingSoon } from "./components/ComingSoon";
import { IconFile, IconImage } from "./components/Icons";

function formatConversationTimestamp(value: string): string {
  const date = new Date(value);
  if (!value.includes("T") || Number.isNaN(date.getTime())) return value;
  return `${date.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })} · ${date.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}`;
}

const AUTO_UNLOAD_IDLE_MS = 60 * 60 * 1000;
const KEEPALIVE_CHECK_MS = 30 * 1000;

const DEFAULT_SETTINGS: AppSettings = {
  appearance: { bgAnimation: true, reducedMotion: false, blurIntensity: 50 },
  update: { autoCheck: true, channel: "stable" },
  ai: {
    thinking: false,
    model: "gemma4:e2b",
    runtimePolicy: "auto",
    contextWindow: 4096,
    maxOutputTokens: 512,
    temperature: 0.7,
    profile: "balanced",
    topP: 0.9,
    topK: 40,
    repeatPenalty: 1.1,
    stopSequences: "",
    seed: null,
  },
};

export default function App() {
  const [view, setView] = useState<View>("chat");
  const [messages, setMessages] = useState<Message[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [panelOpen, setPanelOpen] = useState(false);
  const [versionOpen, setVersionOpen] = useState(false);
  const [appVersion, setAppVersion] = useState(FALLBACK_VERSION);
  const [genState, setGenState] = useState<GenState>("idle");
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus>(
    "runtime_unavailable",
  );
  const [systemReduced, setSystemReduced] = useState(false);
  const [activeConversation, setActiveConversation] = useState<string | null>(null);
  const [memoryPath, setMemoryPath] = useState<string | null>(null);
  const [memoryNotice, setMemoryNotice] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>("idle");
  const [downloadProgress, setDownloadProgress] = useState<UpdateProgressEvent | null>(null);
  const [history, setHistory] = useState<StoredMessage[]>([]);
  const [chatError, setChatError] = useState<string | null>(null);
  const [memoryInitialized, setMemoryInitialized] = useState(false);

  // Handle file attachment: validate, read, and prepare for chat
  const handleAttachFiles = useCallback(async (fileList: FileList) => {
    const files = Array.from(fileList).slice(0, 5); // batasi 5 file per pesan
    for (const file of files) {
      const path = file.name; // di Tauri, kita dapat path lengkap via file API atau invoke
      // Validasi ukuran
      if (file.size > MAX_FILE_BYTES) {
        setAttachments((prev) => [...prev, {
          name: file.name,
          path,
          size: file.size,
          format: "other",
          error: `Ukuran melebihi ${MAX_FILE_BYTES / 1024 / 1024} MB`,
        }]);
        continue;
      }

      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      const format = IMAGE_EXTENSIONS.includes(ext)
        ? "image"
        : TEXT_EXTENSIONS.includes(ext)
          ? "text"
          : "other";

      const att: Attachment = {
        name: file.name,
        path,
        size: file.size,
        format,
      };

      // Process file content
      if (format === "image") {
        // Read image as base64 from File API
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          const base64 = dataUrl.split(",")[1] ?? "";
          setAttachments((prev) => [...prev.filter((a) => a.name !== file.name), { ...att, base64 }]);
        };
        reader.readAsDataURL(file);
      } else if (format === "text") {
        // Read text content
        const text = await file.text();
        setAttachments((prev) => [...prev.filter((a) => a.name !== file.name), { ...att, content: text.slice(0, 8000) }]);
      } else {
        // Unsupported format — show error
        setAttachments((prev) => [...prev.filter((a) => a.name !== file.name), {
          ...att,
          error: `Format .${ext} belum didukung`,
        }]);
      }
    }
  }, []);

  // Refs for streaming state — dibaca oleh event listener tanpa closure issues
  const streamIdRef = useRef<string | null>(null);
  const streamingMsgIdRef = useRef<string | null>(null);
  const chatStartPendingRef = useRef(false);
  const cancelBeforeStartRef = useRef(false);
  const cancelledStreamIdsRef = useRef<Map<string, boolean>>(new Map());
  const messagesRef = useRef<Message[]>([]);
  const eventCleanupRef = useRef<(() => void) | null>(null);
  const keepaliveTimerRef = useRef<number | null>(null);
  // A loaded model at startup starts its idle window from now; zero would cause immediate unload.
  const lastActivityRef = useRef(Date.now());
  const runtimeOperationRef = useRef(false);
  const selectedModelRef = useRef(settings.ai.model);
  const lastAppliedRuntimeConfigRef = useRef<string | null>(null);
  const previousRuntimeGenStateRef = useRef<GenState>("idle");
  const memoryReadyRef = useRef(false);
  const activeConversationRef = useRef<string | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const persistenceTimerRef = useRef<number | null>(null);
  const skipNextPersistenceRef = useRef(false);
  const previousGenStateRef = useRef<GenState>("idle");
  const suppressAutoSaveRef = useRef(false);
  const suppressNextGenerationFlushRef = useRef(false);

  const setActiveConversationId = useCallback((id: string | null) => {
    activeConversationRef.current = id;
    setActiveConversation(id);
  }, []);

  const refreshHistory = useCallback(async () => {
    const list = await invokeListConversations();
    setHistory(list.map((conversation) => ({
      id: conversation.id,
      role: "user" as const,
      text: conversation.title,
      time: formatConversationTimestamp(conversation.updated_at),
    })));
    return list;
  }, []);

  useEffect(() => {
    selectedModelRef.current = settings.ai.model;
  }, [settings.ai.model]);

  const refreshRuntimeStatus = useCallback(async () => {
    const modelId = selectedModelRef.current;
    const status = await invokeRuntimeStatus(modelId);
    if (selectedModelRef.current === modelId) {
      setRuntimeStatus((status as RuntimeStatus | null) ?? "runtime_unavailable");
      if (status === "ready") lastActivityRef.current = Date.now();
    }
    return status;
  }, []);

  // Versi aplikasi dari Tauri bila tersedia
  useEffect(() => {
    let alive = true;
    readAppVersion(FALLBACK_VERSION).then((v) => {
      if (alive) setAppVersion(v);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Hormati preferensi reduced-motion sistem
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setSystemReduced(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Mirror messages to ref for chat_start payload
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    activeConversationRef.current = activeConversation;
  }, [activeConversation]);

  // ── Initialize local storage, settings, history, and the last conversation ──
  useEffect(() => {
    let alive = true;

    const initialize = async () => {
      // Ensure the conversation directory exists before listing it.
      const memoryReady = await invokeEnsureMemoryDir();
      if (!alive) return;
      memoryReadyRef.current = memoryReady;

      const path = await invokeMemoryPath();
      if (!alive) return;
      if (path) setMemoryPath(path);

      const [saved, list] = await Promise.all([
        invokeLoadSettings(),
        invokeListConversations(),
      ]);
      if (!alive) return;

      if (saved) {
        if (saved.appearance) {
          setSettings((current) => ({
            ...current,
            appearance: {
              ...current.appearance,
              ...(saved.appearance as Record<string, unknown>),
            },
          }));
        }
        if (saved.ai) {
          const savedAi = { ...(saved.ai as Record<string, unknown>) };
          if (savedAi.model !== "gemma4:e2b") savedAi.model = DEFAULT_SETTINGS.ai.model;
          setSettings((current) => ({
            ...current,
            ai: { ...current.ai, ...savedAi },
          }));
        }
      }

      setHistory(list.map((conversation) => ({
        id: conversation.id,
        role: "user" as const,
        text: conversation.title,
        time: formatConversationTimestamp(conversation.updated_at),
      })));

      const latest = list[0];
      if (latest) {
        const conversation = await invokeLoadConversation(latest.id);
        if (!alive) return;
        if (conversation) {
          // Restoration is not new activity; keep the saved timestamp unchanged.
          skipNextPersistenceRef.current = true;
          setActiveConversationId(conversation.id);
          setMessages(conversation.messages.map((message) => ({
            id: message.id,
            role: message.role,
            text: message.text,
            time: message.time,
            streaming: false,
          })));
        }
      }

      if (alive) {
        setMemoryInitialized(memoryReady);
        if (!memoryReady) {
          setChatError("Penyimpanan lokal tidak dapat disiapkan. Percakapan baru belum bisa disimpan.");
        }
      }
    };

    void initialize().catch(() => {
      if (alive) setChatError("Gagal memulihkan penyimpanan lokal. Data percakapan lama tidak dihapus.");
    });

    return () => {
      alive = false;
      if (persistenceTimerRef.current !== null) {
        window.clearTimeout(persistenceTimerRef.current);
        persistenceTimerRef.current = null;
      }
    };
  }, [setActiveConversationId]);

  // ── Fetch runtime status on mount & model change ──
  useEffect(() => {
    let alive = true;
    setRuntimeStatus("loading");
    invokeRuntimeStatus(settings.ai.model).then((status) => {
      if (!alive) return;
      if (!status) {
        setRuntimeStatus("runtime_unavailable");
        return;
      }
      setRuntimeStatus(status as RuntimeStatus);
      // A model discovered as loaded starts a fresh idle interval from now.
      if (status === "ready") lastActivityRef.current = Date.now();
    });
    return () => {
      alive = false;
    };
  }, [settings.ai.model]);

  // Refresh model state once a chat ends. A request that starts from "unloaded"
  // still leaves a resident model, and that status is needed to arm the idle timer.
  useEffect(() => {
    const previous = previousRuntimeGenStateRef.current;
    previousRuntimeGenStateRef.current = genState;
    if (previous !== "generating" || genState !== "idle") return;

    void invokeRuntimeStatus(settings.ai.model).then((status) => {
      if (!status) return;
      setRuntimeStatus(status as RuntimeStatus);
      if (status === "ready") lastActivityRef.current = Date.now();
    });
  }, [genState, settings.ai.model]);

  // Apply persisted or changed runtime policy to a model already loaded in RAM.
  // Defer briefly after chat completion so the backend can remove the terminal stream
  // from its registry before the policy-setting request checks that registry.
  useEffect(() => {
    if (runtimeStatus !== "ready" || genState !== "idle") return;
    if (chatStartPendingRef.current || streamIdRef.current !== null || runtimeOperationRef.current) return;

    const configKey = `${settings.ai.model}|${settings.ai.runtimePolicy}`;
    if (lastAppliedRuntimeConfigRef.current === configKey) return;
    lastAppliedRuntimeConfigRef.current = configKey;
    runtimeOperationRef.current = true;
    let operationStarted = false;

    const timerId = window.setTimeout(() => {
      operationStarted = true;
      setRuntimeStatus("loading");
      void (async () => {
        try {
          const loaded = await invokeLoadModel(settings.ai.model, settings.ai.runtimePolicy);
          if (!loaded) {
            setChatError("Kebijakan runtime belum berhasil diterapkan ke Ollama. Periksa status runtime lalu coba lagi.");
          } else {
            lastActivityRef.current = Date.now();
          }
          const refreshed = await invokeRuntimeStatus(settings.ai.model);
          setRuntimeStatus((refreshed as RuntimeStatus | null) ?? (loaded ? "ready" : "error"));
        } catch {
          setChatError("Gagal menerapkan kebijakan runtime ke Ollama.");
          setRuntimeStatus("error");
        } finally {
          runtimeOperationRef.current = false;
        }
      })();
    }, 200);

    return () => {
      window.clearTimeout(timerId);
      if (!operationStarted) runtimeOperationRef.current = false;
    };
  }, [settings.ai.model, settings.ai.runtimePolicy, runtimeStatus, genState]);

  // ── Runtime lifecycle: automatically unload only after a full idle hour ──
  useEffect(() => {
    if (settings.ai.runtimePolicy !== "auto" || runtimeStatus !== "ready") return;
    if (genState !== "idle") return;

    const timerId = window.setInterval(() => {
      if (Date.now() - lastActivityRef.current < AUTO_UNLOAD_IDLE_MS) return;
      if (
        chatStartPendingRef.current ||
        streamIdRef.current !== null ||
        runtimeOperationRef.current
      ) return;

      // Lock synchronously before IPC so manual and automatic unload can't overlap.
      runtimeOperationRef.current = true;
      setRuntimeStatus("unloading");

      void (async () => {
        try {
          const unloaded = await invokeUnloadModel(settings.ai.model);
          if (!unloaded) {
            lastActivityRef.current = Date.now();
            setChatError("Model otomatis gagal dilepas dari RAM. Model tetap tersedia; coba lagi melalui Pengaturan.");
            const refreshed = await invokeRuntimeStatus(settings.ai.model);
            setRuntimeStatus((refreshed as RuntimeStatus | null) ?? "ready");
            return;
          }

          const refreshed = await invokeRuntimeStatus(settings.ai.model);
          // Ollama can briefly report the model as ready after accepting the unload request.
          setRuntimeStatus(
            refreshed && refreshed !== "ready"
              ? refreshed as RuntimeStatus
              : "unloaded",
          );
        } catch {
          lastActivityRef.current = Date.now();
          setChatError("Terjadi kesalahan saat melepas model dari RAM. Periksa status Ollama.");
          const refreshed = await invokeRuntimeStatus(settings.ai.model);
          setRuntimeStatus((refreshed as RuntimeStatus | null) ?? "ready");
        } finally {
          runtimeOperationRef.current = false;
        }
      })();
    }, KEEPALIVE_CHECK_MS);

    keepaliveTimerRef.current = timerId;
    return () => {
      window.clearInterval(timerId);
      if (keepaliveTimerRef.current === timerId) keepaliveTimerRef.current = null;
    };
  }, [settings.ai.runtimePolicy, runtimeStatus, genState, settings.ai.model]);

  // ── Set up SSE event listeners once ──
  useEffect(() => {
    let mounted = true;
    listenChatEvents({
      onStarted: (e) => {
        // If stop/new-chat happened before chat_start resolved, cancel this late ID
        // instead of reviving a stream the UI has already abandoned.
        if (cancelBeforeStartRef.current || cancelledStreamIdsRef.current.has(e.id)) {
          // true means a terminal event was already received while chat_start's
          // invoke promise was still settling; don't reinsert a completed stream ID.
          if (cancelledStreamIdsRef.current.get(e.id) !== true) {
            cancelledStreamIdsRef.current.set(e.id, false);
            void invokeChatCancel(e.id);
          }
          return;
        }
        // Capture the ID from events so early chunks don't depend on invoke timing.
        streamIdRef.current = e.id;
      },
      onChunk: (e) => {
        // A late stream may still deliver its final event after the user cancelled it.
        if (cancelledStreamIdsRef.current.has(e.id)) {
          if (e.done) {
            if (chatStartPendingRef.current) cancelledStreamIdsRef.current.set(e.id, true);
            else cancelledStreamIdsRef.current.delete(e.id);
            void refreshRuntimeStatus();
          }
          return;
        }
        if (!mounted) return;
        if (e.id !== streamIdRef.current) return;

        if (e.done) {
          // Start a new idle window from the end of a completed or cancelled stream.
          lastActivityRef.current = Date.now();
          // Finalise: mark message as not streaming
          setGenState("idle");
          setStreamIdRef(null);
          finishStream();
          void refreshRuntimeStatus();
          return;
        }

        // Append thinking / content to the streaming message
        setMessages((m) =>
          m.map((msg) => {
            if (msg.id === streamingMsgIdRef.current) {
              const updated: Message = {
                ...msg,
                text: e.content ? msg.text + e.content : msg.text,
                streaming: true,
              };
              return updated;
            }
            return msg;
          }),
        );
      },
      onError: (e) => {
        if (cancelledStreamIdsRef.current.has(e.id)) {
          if (chatStartPendingRef.current) cancelledStreamIdsRef.current.set(e.id, true);
          else cancelledStreamIdsRef.current.delete(e.id);
          void refreshRuntimeStatus();
          return;
        }
        if (!mounted || e.id !== streamIdRef.current) return;
        lastActivityRef.current = Date.now();
        const failedMessageId = streamingMsgIdRef.current;
        if (failedMessageId) {
          setMessages((current) => {
            const failed = current.find((msg) => msg.id === failedMessageId);
            if (!failed || failed.text.trim() === "") {
              return current.filter((msg) => msg.id !== failedMessageId);
            }
            return current.map((msg) =>
              msg.id === failedMessageId ? { ...msg, streaming: false } : msg,
            );
          });
        }
        streamingMsgIdRef.current = null;
        setGenState("idle");
        setStreamIdRef(null);
        setChatError(`Respons model terhenti sebelum selesai: ${e.message}`);
        void refreshRuntimeStatus();
      },
      onDone: () => {
        // Statistik selesai — tidak perlu update UI tambahan
      },
    }).then((cleanup) => {
      if (mounted) eventCleanupRef.current = cleanup;
    });

    return () => {
      mounted = false;
      eventCleanupRef.current?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setStreamIdRef(id: string | null) {
    streamIdRef.current = id;
  }

  function finishStream() {
    if (streamingMsgIdRef.current) {
      setMessages((m) =>
        m.map((msg) =>
          msg.id === streamingMsgIdRef.current
            ? { ...msg, streaming: false }
            : msg,
        ),
      );
      streamingMsgIdRef.current = null;
    }
  }

  /// Generate title from first user message (max 50 chars).
  function titleFromMessages(msgs: Message[]): string {
    const first = msgs.find((m) => m.role === "user");
    if (!first) return "Percakapan baru";
    const t = first.text.trim();
    return t.length > 50 ? t.slice(0, 50) + "..." : t;
  }

  /// Persist a snapshot to the current conversation ID. The queue prevents an older
  /// async write from finishing after and overwriting a newer snapshot.
  const persistConversation = useCallback(async (): Promise<boolean> => {
    if (!memoryReadyRef.current) return false;

    const currentMessages = messagesRef.current;
    if (currentMessages.length === 0) return true;

    let conversationId = activeConversationRef.current;
    if (!conversationId) {
      conversationId = uid();
      setActiveConversationId(conversationId);
    }

    const snapshot = {
      id: conversationId,
      title: titleFromMessages(currentMessages),
      updated_at: new Date().toISOString(),
      messages: currentMessages.map((message) => ({
        id: message.id,
        role: message.role,
        text: message.text,
        time: message.time,
      })),
    };

    const write = saveQueueRef.current.then(async () => {
      const saved = await invokeSaveConversation(snapshot);
      if (!saved) {
        setChatError("Percakapan belum berhasil disimpan ke .AzaleaMemory. Periksa izin folder penyimpanan.");
        return false;
      }
      await refreshHistory();
      return true;
    });
    saveQueueRef.current = write.then(() => undefined, () => undefined);
    return write;
  }, [refreshHistory, setActiveConversationId]);

  // Periodic autosave: keep a single timer alive while stream chunks continue,
  // rather than postponing persistence until a long response has fully stopped.
  useEffect(() => {
    if (suppressAutoSaveRef.current) return;
    if (!memoryInitialized || !memoryReadyRef.current || messages.length === 0) return;

    if (skipNextPersistenceRef.current) {
      skipNextPersistenceRef.current = false;
      return;
    }

    if (persistenceTimerRef.current !== null) return;
    persistenceTimerRef.current = window.setTimeout(() => {
      persistenceTimerRef.current = null;
      void persistConversation();
    }, 1200);
  }, [messages, memoryInitialized, persistConversation]);

  // Flush promptly when a generation finishes or is cancelled, after messagesRef
  // has received the final committed message state.
  useEffect(() => {
    const wasGenerating = previousGenStateRef.current === "generating";
    previousGenStateRef.current = genState;
    const skipFlushForSessionSwitch = suppressNextGenerationFlushRef.current;
    suppressNextGenerationFlushRef.current = false;
    if (suppressAutoSaveRef.current || skipFlushForSessionSwitch || !wasGenerating || genState !== "idle" || !memoryInitialized || messages.length === 0) return;

    if (persistenceTimerRef.current !== null) {
      window.clearTimeout(persistenceTimerRef.current);
      persistenceTimerRef.current = null;
    }
    void persistConversation();
  }, [genState, memoryInitialized, messages.length, persistConversation]);

  /// Save settings whenever they change (debounced via useEffect).
  useEffect(() => {
    if (!memoryInitialized || !memoryReadyRef.current) return;
    invokeSaveSettings(settings).catch(() => { /* ignore */ });
  }, [settings.ai, settings.appearance, memoryInitialized]);

  const animAllowed =
    settings.appearance.bgAnimation && !settings.appearance.reducedMotion && !systemReduced;

  const blurScale = 0.4 + (settings.appearance.blurIntensity / 100) * 1.2;

  const patchSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((s) => ({ ...s, ...patch }));
  }, []);

  const patchAi = useCallback((patch: Partial<AiSettings>) => {
    setSettings((s) => ({ ...s, ai: { ...s.ai, ...patch } }));
  }, []);

  const applyProfile = useCallback((p: ProfileId) => {
    const preset = profileById(p);
    setSettings((s) => ({
      ...s,
      ai: { ...s.ai, profile: p, thinking: preset.thinking, maxOutputTokens: preset.outputTokens },
    }));
  }, []);

  // ── Send message: real local model only ──
  const sendMessage = useCallback(
    async (text: string, attached: Attachment[]): Promise<boolean> => {
      const t = text.trim();
      if (t === "" && attached.length === 0) return false;
      if (!memoryInitialized || !memoryReadyRef.current) {
        setChatError("Penyimpanan lokal masih disiapkan atau tidak tersedia. Tunggu sampai inisialisasi selesai, lalu coba lagi.");
        return false;
      }
      if (runtimeOperationRef.current) {
        setChatError("Model sedang dimuat atau dilepas dari RAM. Tunggu sampai operasi selesai, lalu coba lagi.");
        return false;
      }
      if (genState !== "idle") return false;
      if (chatStartPendingRef.current) {
        setChatError("Permintaan sebelumnya masih dibatalkan. Tunggu sampai proses itu selesai, lalu coba lagi.");
        return false;
      }

      if (runtimeStatus !== "ready" && runtimeStatus !== "unloaded") {
        const readinessMessage: Record<RuntimeStatus, string> = {
          not_installed: "Ollama belum terpasang. Pasang Ollama terlebih dahulu untuk memakai chat AI lokal.",
          runtime_unavailable: "Ollama tidak dapat dihubungi. Buka Ollama dan pastikan runtime lokal berjalan, lalu coba lagi.",
          model_not_downloaded: `Model ${settings.ai.model} belum diunduh. Unduh model tersebut terlebih dahulu, lalu coba lagi.`,
          loading: "Model masih dimuat. Tunggu sampai status model siap sebelum mengirim pesan.",
          ready: "",
          thinking: "Model sedang berpikir. Tunggu sampai respons saat ini selesai.",
          generating: "Model sedang menghasilkan respons. Tunggu sampai respons saat ini selesai.",
          unloading: "Model sedang dilepas dari memori. Tunggu sampai proses selesai, lalu coba lagi.",
          unloaded: "",
          error: "Runtime AI mengalami kesalahan. Periksa Ollama dan status model, lalu coba lagi.",
        };
        setChatError(readinessMessage[runtimeStatus]);
        return false;
      }

      setChatError(null);

      let attachmentContext = "";
      const images: string[] = [];
      for (const a of attached) {
        if (a.format === "image" && a.base64) images.push(a.base64);
        if (a.content) {
          attachmentContext += `\n\n--- Lampiran: ${a.name} ---\n${a.content.slice(0, 4000)}\n---`;
        }
        if (a.error) {
          attachmentContext += `\n\n[Lampiran: ${a.name} — ${a.error}]`;
        }
      }

      const userMsg: Message = {
        id: uid(),
        role: "user",
        text: t + attachmentContext,
        time: clockNow(),
        images: images.length > 0 ? images : undefined,
      };
      const messagesBeforeSend = messagesRef.current;
      lastActivityRef.current = Date.now();
      setMessages((current) => [...current, userMsg]);

      setGenState("generating");
      const msgId = uid();
      streamingMsgIdRef.current = msgId;
      setMessages((current) => [
        ...current,
        { id: msgId, role: "assistant", text: "", time: clockNow(), streaming: true },
      ]);

      const payload: ChatStartPayload = {
        model: settings.ai.model,
        messages: [...messagesBeforeSend, userMsg].map((message) => ({
          role: message.role,
          content: message.text,
          images: message.images,
        })),
        think: settings.ai.thinking,
      runtimePolicy: settings.ai.runtimePolicy,
        options: {
          temperature: settings.ai.temperature,
          num_ctx: settings.ai.contextWindow,
          num_predict: settings.ai.maxOutputTokens,
          top_p: settings.ai.topP,
          top_k: settings.ai.topK,
          repeat_penalty: settings.ai.repeatPenalty,
          stop: settings.ai.stopSequences.split(",").map((s) => s.trim()).filter(Boolean),
          seed: settings.ai.seed,
        },
      };

      chatStartPendingRef.current = true;
      cancelBeforeStartRef.current = false;
      const id = await invokeChatStart(payload);
      chatStartPendingRef.current = false;

      if (cancelBeforeStartRef.current || (id && cancelledStreamIdsRef.current.has(id))) {
        cancelBeforeStartRef.current = false;
        if (id) {
          if (cancelledStreamIdsRef.current.get(id) === true) {
            cancelledStreamIdsRef.current.delete(id);
          } else {
            cancelledStreamIdsRef.current.set(id, false);
            void invokeChatCancel(id);
          }
        }
        streamIdRef.current = null;
        return false;
      }

      if (!id) {
        // Backend belum menerima pesan: kembalikan chat ke keadaan sebelum kirim,
        // supaya input pengguna tetap tersedia untuk dicoba ulang.
        setMessages((current) =>
          current.filter((message) => message.id !== msgId && message.id !== userMsg.id),
        );
        if (streamingMsgIdRef.current === msgId) streamingMsgIdRef.current = null;
        streamIdRef.current = null;
        cancelBeforeStartRef.current = false;
        setGenState("idle");
        lastActivityRef.current = Date.now();
        setChatError("AzaleaHouse gagal memulai respons dari model lokal. Pastikan Ollama aktif dan model tersedia, lalu coba lagi.");
        void refreshRuntimeStatus();
        return false;
      }

      streamIdRef.current = id;
      lastActivityRef.current = Date.now();
      // The chat request itself has applied this keep_alive policy to Ollama.
      lastAppliedRuntimeConfigRef.current = `${settings.ai.model}|${settings.ai.runtimePolicy}`;
      return true;
    },
    [genState, runtimeStatus, settings.ai, refreshRuntimeStatus],
  );

  // ── Stop / cancel ──
  const stopGeneration = useCallback(() => {
    lastActivityRef.current = Date.now();
    const messageId = streamingMsgIdRef.current;
    const activeStreamId = streamIdRef.current;
    cancelBeforeStartRef.current = chatStartPendingRef.current;
    if (activeStreamId) {
      cancelledStreamIdsRef.current.set(activeStreamId, false);
      void invokeChatCancel(activeStreamId);
    }

    if (messageId) {
      setMessages((current) =>
        current.map((message) =>
          message.id === messageId
            ? {
                ...message,
                text: message.text
                  ? `${message.text}\n\nGenerasi dihentikan.`
                  : "Generasi dihentikan.",
                streaming: false,
              }
            : message,
        ),
      );
    }

    streamingMsgIdRef.current = null;
    setGenState("idle");
    setStreamIdRef(null);
  }, []);

  // ── Regenerate ──
  const regenerate = useCallback(() => {
    const current = messagesRef.current;
    const last = current[current.length - 1];
    if (!last || last.role !== "assistant" || genState === "generating" || chatStartPendingRef.current) return;
    if (runtimeOperationRef.current) {
      setChatError("Model sedang dimuat atau dilepas dari RAM. Tunggu sampai operasi selesai, lalu coba lagi.");
      return;
    }

    if (runtimeStatus !== "ready" && runtimeStatus !== "unloaded") {
      setChatError("Model lokal belum siap. Periksa status Ollama dan model sebelum membuat ulang respons.");
      return;
    }

    const userMsg = [...current].reverse().find((message) => message.role === "user");
    if (!userMsg) return;

    const idx = current.lastIndexOf(userMsg);
    const messagesToSend = current.slice(0, idx + 1);
    setChatError(null);
    lastActivityRef.current = Date.now();
    setMessages((messages) => messages.slice(0, idx + 1));
    setGenState("generating");

    const msgId = uid();
    streamingMsgIdRef.current = msgId;
    setMessages((messages) => [
      ...messages,
      { id: msgId, role: "assistant", text: "", time: clockNow(), streaming: true },
    ]);

    const payload: ChatStartPayload = {
      model: settings.ai.model,
      messages: messagesToSend.map((message) => ({
        role: message.role,
        content: message.text,
        images: message.images,
      })),
      think: settings.ai.thinking,
        runtimePolicy: settings.ai.runtimePolicy,
      options: {
        temperature: settings.ai.temperature,
        num_ctx: settings.ai.contextWindow,
        num_predict: settings.ai.maxOutputTokens,
        top_p: settings.ai.topP,
        top_k: settings.ai.topK,
        repeat_penalty: settings.ai.repeatPenalty,
        stop: settings.ai.stopSequences.split(",").map((s) => s.trim()).filter(Boolean),
        seed: settings.ai.seed,
      },
    };

    chatStartPendingRef.current = true;
    cancelBeforeStartRef.current = false;
    void invokeChatStart(payload).then((id) => {
      chatStartPendingRef.current = false;
      if (cancelBeforeStartRef.current || (id && cancelledStreamIdsRef.current.has(id))) {
        cancelBeforeStartRef.current = false;
        if (id) {
          if (cancelledStreamIdsRef.current.get(id) === true) {
            cancelledStreamIdsRef.current.delete(id);
          } else {
            cancelledStreamIdsRef.current.set(id, false);
            void invokeChatCancel(id);
          }
        }
        streamIdRef.current = null;
        return;
      }
      if (id) {
        streamIdRef.current = id;
        lastActivityRef.current = Date.now();
        // The chat request itself has applied this keep_alive policy to Ollama.
        lastAppliedRuntimeConfigRef.current = `${settings.ai.model}|${settings.ai.runtimePolicy}`;
        return;
      }
      cancelBeforeStartRef.current = false;
      lastActivityRef.current = Date.now();
      setMessages((messages) => messages.filter((message) => message.id !== msgId));
      if (streamingMsgIdRef.current === msgId) streamingMsgIdRef.current = null;
      streamIdRef.current = null;
      setGenState("idle");
      setChatError("AzaleaHouse gagal membuat ulang respons dari model lokal. Periksa Ollama lalu coba lagi.");
      void refreshRuntimeStatus();
    });
  }, [genState, runtimeStatus, settings.ai, refreshRuntimeStatus]);

  // ── New chat ──
  const newChat = useCallback(() => {
    setChatError(null);
    cancelBeforeStartRef.current = chatStartPendingRef.current;
    if (streamIdRef.current) {
      cancelledStreamIdsRef.current.set(streamIdRef.current, false);
      void invokeChatCancel(streamIdRef.current);
    }
    // Flush the current snapshot before switching to an independent empty session.
    if (persistenceTimerRef.current !== null) {
      window.clearTimeout(persistenceTimerRef.current);
      persistenceTimerRef.current = null;
    }
    void persistConversation();
    setGenState("idle");
    setStreamIdRef(null);
    streamingMsgIdRef.current = null;
    setActiveConversationId(uid());
    setMessages([]);
    setAttachments([]);
    setView("chat");
  }, [persistConversation, setActiveConversationId]);

  // ── Load conversation from history ──
  const openConversation = useCallback(async (id: string) => {
    // Prevent a cancellation/finalization effect from writing to the session being left.
    suppressAutoSaveRef.current = true;
    try {
      if (streamIdRef.current || chatStartPendingRef.current) {
        suppressNextGenerationFlushRef.current = true;
        stopGeneration();
      }
      if (persistenceTimerRef.current !== null) {
        window.clearTimeout(persistenceTimerRef.current);
        persistenceTimerRef.current = null;
      }
      await persistConversation();

      const conversation = await invokeLoadConversation(id);
      if (!conversation) {
        setChatError("Percakapan tidak dapat dibuka. File mungkin sudah dipindahkan atau rusak.");
        return;
      }

      skipNextPersistenceRef.current = true;
      setActiveConversationId(conversation.id);
      setMessages(conversation.messages.map((message) => ({
        id: message.id,
        role: message.role,
        text: message.text,
        time: message.time,
        streaming: false,
      })));
      setAttachments([]);
      setChatError(null);
      setView("chat");
    } finally {
      suppressAutoSaveRef.current = false;
    }
  }, [persistConversation, setActiveConversationId, stopGeneration]);

  // ── Delete a conversation and refresh the persistent history list ──
  const deleteConversation = useCallback(async (id: string) => {
    if (persistenceTimerRef.current !== null) {
      window.clearTimeout(persistenceTimerRef.current);
      persistenceTimerRef.current = null;
    }
    const deletingActive = activeConversationRef.current === id;
    if (deletingActive) suppressAutoSaveRef.current = true;

    try {
      if (deletingActive) {
        if (streamIdRef.current || chatStartPendingRef.current) {
          suppressNextGenerationFlushRef.current = true;
          stopGeneration();
        }
        await persistConversation();
      }

      const deleted = await invokeDeleteConversation(id);
      if (!deleted) {
        setChatError("Percakapan tidak berhasil dihapus dari penyimpanan lokal.");
        return;
      }

      if (activeConversationRef.current === id) {
        setActiveConversationId(null);
        setMessages([]);
        setAttachments([]);
      }
      await refreshHistory();
    } finally {
      if (deletingActive) suppressAutoSaveRef.current = false;
    }
  }, [persistConversation, refreshHistory, setActiveConversationId, stopGeneration]);

  const model = models.find((m) => m.id === settings.ai.model) ?? models[0];

  // ── Manual model unload ──
  const unloadModel = useCallback(async () => {
    if (runtimeOperationRef.current) {
      setChatError("Operasi model sedang berlangsung. Tunggu sampai selesai sebelum melepas model.");
      return;
    }
    if (
      genState !== "idle" ||
      chatStartPendingRef.current ||
      streamIdRef.current !== null
    ) {
      setChatError("Model tidak bisa dilepas selama chat sedang berjalan. Hentikan atau tunggu respons selesai.");
      return;
    }
    if (runtimeStatus !== "ready") return;

    runtimeOperationRef.current = true;
    setRuntimeStatus("unloading");
    try {
      const unloaded = await invokeUnloadModel(settings.ai.model);
      if (!unloaded) {
        lastActivityRef.current = Date.now();
        setChatError("Gagal melepas model dari RAM. Periksa status Ollama lalu coba lagi.");
        const refreshed = await invokeRuntimeStatus(settings.ai.model);
        setRuntimeStatus((refreshed as RuntimeStatus | null) ?? "ready");
        return;
      }

      const refreshed = await invokeRuntimeStatus(settings.ai.model);
      setRuntimeStatus(
        refreshed && refreshed !== "ready"
          ? refreshed as RuntimeStatus
          : "unloaded",
      );
    } catch {
      lastActivityRef.current = Date.now();
      setChatError("Terjadi kesalahan saat melepas model dari RAM. Periksa status Ollama lalu coba lagi.");
      const refreshed = await invokeRuntimeStatus(settings.ai.model);
      setRuntimeStatus((refreshed as RuntimeStatus | null) ?? "ready");
    } finally {
      runtimeOperationRef.current = false;
    }
  }, [genState, runtimeStatus, settings.ai.model]);

  // ── Memory operations (Phase 1 hardening / Phase 4 storage) ──
  const openMemoryFolder = useCallback(async () => {
    const opened = await invokeOpenMemoryFolder();
    setMemoryNotice(opened
      ? "Folder memori dibuka di File Explorer."
      : "Folder memori tidak dapat dibuka. Periksa lokasi penyimpanan.");
  }, []);

  const changeMemoryPath = useCallback(async () => {
    try {
      const selectedParent = await invokePickMemoryParentFolder();
      if (!selectedParent) return;
      setMemoryNotice("Memvalidasi lokasi dan menyalin data memori...");
      await invokeSetCustomPath(selectedParent);
      const activePath = await invokeMemoryPath();
      if (!activePath) throw new Error("Lokasi memori aktif tidak dapat dibaca setelah migrasi.");
      setMemoryPath(activePath);
      setMemoryNotice(`Lokasi memori berhasil dipindahkan ke ${activePath}. Data sumber lama tidak dihapus.`);
    } catch (error) {
      setMemoryNotice(`Gagal memindahkan lokasi memori: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, []);

  const backupMemory = useCallback(async () => {
    try {
      const backupPath = await invokeBackupMemory();
      if (!backupPath) throw new Error("Lokasi cadangan tidak dikembalikan oleh backend.");
      setMemoryNotice(`Cadangan memori dibuat di: ${backupPath}`);
    } catch (error) {
      setMemoryNotice(`Gagal membuat cadangan memori: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, []);

  // ── Update operations (Phase 7) ──
  const checkForUpdate = useCallback(async () => {
    setUpdateStatus("checking");
    const info = await invokeCheckUpdate();
    if (info) {
      setUpdateInfo(info);
      if (info.error) {
        setUpdateStatus("offline");
      } else if (info.available) {
        setUpdateStatus("update_available");
      } else {
        setUpdateStatus("up_to_date");
      }
    } else {
      setUpdateStatus("offline");
    }
  }, []);

  const downloadUpdate = useCallback(async () => {
    if (!updateInfo || updateInfo.assets.length === 0) return;
    const asset = updateInfo.assets[0];
    if (!asset) return;
    setUpdateStatus("downloading");
    const path = await invokeDownloadUpdate(asset.url, asset.name);
    if (path) {
      setUpdateStatus("downloaded");
    } else {
      setUpdateStatus("error");
    }
  }, [updateInfo]);

  const cancelDownload = useCallback(async () => {
    await invokeCancelDownload();
    setUpdateStatus("idle");
  }, []);

  // Listen for download progress events
  useEffect(() => {
    const cleanup = listenUpdateProgress((e) => {
      setDownloadProgress(e);
    });
    return cleanup;
  }, []);

  // Auto-check on mount
  useEffect(() => {
    void checkForUpdate();
  }, [checkForUpdate]);

  const rootClass = "app" + (animAllowed ? " anim-allowed" : "");

  return (
    <ErrorBoundary>
      <div className={rootClass} style={{ "--blur-scale": String(blurScale) } as React.CSSProperties}>
        <BackgroundLayer animated={animAllowed} />

        <Sidebar
        view={view}
        onNavigate={setView}
        onNewChat={newChat}
        runtimeStatus={runtimeStatus}
        version={appVersion}
        onOpenVersionCenter={() => setVersionOpen(true)}
        onUnloadModel={unloadModel}
      />

      <main className="main">
        {view === "chat" ? (
          <div className="view-fade">
            <ChatView
              messages={messages}
              genState={genState}
              animAllowed={animAllowed}
              modelName={model?.name ?? "Model"}
              panelOpen={panelOpen}
              onTogglePanel={() => setPanelOpen((o) => !o)}
              onNewChat={newChat}
              onSend={sendMessage}
              onClearAttachments={() => setAttachments([])}
              onStop={stopGeneration}
              onRegenerate={regenerate}
              thinking={settings.ai.thinking}
              onToggleThinking={() => patchAi({ thinking: !settings.ai.thinking })}
              thinkingSupported={model?.thinkingSupported ?? true}
              profile={settings.ai.profile}
              onProfileChange={applyProfile}
              runtimeStatus={runtimeStatus}
              chatError={chatError}
              onDismissChatError={() => setChatError(null)}
              attachments={attachments}
              onRemoveAttachment={(name) => setAttachments((prev) => prev.filter((a) => a.name !== name))}
              onAttachFiles={handleAttachFiles}
            />
          </div>
        ) : null}

        {view === "settings" ? (
          <div className="view-fade">
            <SettingsScreen
              settings={settings}
              onChange={patchSettings}
              onBack={() => setView("chat")}
              runtimeStatus={runtimeStatus}
              onUnloadModel={unloadModel}
              modelBusy={genState === "generating" || runtimeStatus === "unloading"}
              memoryPath={memoryPath}
              memoryNotice={memoryNotice}
              onOpenMemoryFolder={openMemoryFolder}
              onChangeMemoryPath={changeMemoryPath}
              onBackupMemory={backupMemory}
            />
          </div>
        ) : null}

        {view === "documents" ? (
          <div className="view-fade">
            <ComingSoon
              icon={<IconFile size={28} />}
              title="Dokumen"
              desc="Pembuatan dokumen DOCX/PDF dengan layout rapi akan hadir di sini."
              phase="Fase 6"
            />
          </div>
        ) : null}

        {view === "images" ? (
          <div className="view-fade">
            <ComingSoon
              icon={<IconImage size={28} />}
              title="Gambar"
              desc="Analisis gambar dan screenshot lewat pipeline vision akan hadir di sini."
              phase="Fase 5"
            />
          </div>
        ) : null}

        {view === "history" ? (
          <div className="view-fade">
            <HistoryView
              history={history}
              onOpen={openConversation}
              onDelete={deleteConversation}
              onBack={() => setView("chat")}
            />
          </div>
        ) : null}
      </main>

      {view === "chat" && panelOpen ? (
        <SettingsPanel
          settings={settings.ai}
          onChange={patchAi}
          onOpenAdvanced={() => setView("settings")}
        />
      ) : null}

      <VersionCenter
        open={versionOpen}
        onClose={() => setVersionOpen(false)}
        version={appVersion}
        updateInfo={updateInfo}
        updateStatus={updateStatus}
        downloadProgress={downloadProgress}
        onCheck={checkForUpdate}
        onDownload={downloadUpdate}
        onCancelDownload={cancelDownload}
      />
      </div>
    </ErrorBoundary>
  );
}
