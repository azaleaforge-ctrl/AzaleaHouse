import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AiProvider,
  AiSettings,
  AppSettings,
  GenState,
  Message,
  MessageAttachment,
  ProfileId,
  RuntimeStatus,
  View,
} from "./types";
import type { Attachment } from "./types";
import type { UpdateStatus } from "./types";
import type { UpdateInfo, UpdateProgressEvent, StoredMessage, ChatStartPayload, ModelMeta, RouterModel } from "./lib/tauri";
import {
  FALLBACK_VERSION,
  MAX_FILE_BYTES,
  profileById,
} from "./data/mock";
import { clockNow, uid } from "./lib/format";
import { readAppVersion } from "./lib/tauri";
import {
  invokeChatCancel,
  invokeChatStart,
  invokeRuntimeStatus,
  invokeListModels,
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
  invokeInstallUpdate,
  invokeCancelDownload,
  listenUpdateProgress,
  invokeUnloadModel,
  invokeLoadModel,
  invokeSaveAttachmentBytes,
  invokeLoadAttachmentBase64,
  listenChatEvents,
  invokeConnect9Router,
  invokeDisconnect9Router,
  invokeRouterChatStart,
  invokeWebSearch,
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
import { DocumentsView } from "./components/DocumentsView";
import { LocalAiView } from "./components/LocalAiView";
import { IconImage } from "./components/Icons";
import { parseSelectedFile, buildAttachmentContext } from "./lib/file-reader";
import { buildSkillsPrompt, detectSkills } from "./data/skills";
import type { SkillId } from "./data/skills";
import { CommandDialog } from "./components/CommandDialog";
import type { CommandDialogMode } from "./components/CommandDialog";

function formatConversationTimestamp(value: string): string {
  const date = new Date(value);
  if (!value.includes("T") || Number.isNaN(date.getTime())) return value;
  return `${date.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })} · ${date.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}`;
}

const AUTO_UNLOAD_IDLE_MS = 60 * 60 * 1000;
const KEEPALIVE_CHECK_MS = 30 * 1000;

/** Compile only recent, relevant attachment excerpts into model context. */
async function buildModelMessages(messages: Message[]): Promise<ChatStartPayload["messages"]> {
  const userMessagesWithAttachments = messages
    .filter((message) => message.role === "user" && Boolean(message.attachments?.length))
    .slice(-3);
  const selectedIds = new Set(userMessagesWithAttachments.map((message) => message.id));
  const recentAttachments = userMessagesWithAttachments.flatMap((message) => message.attachments ?? []);
  const latestUser = [...messages].reverse().find((message) => message.role === "user");
  const attachmentContext = buildAttachmentContext(latestUser?.text ?? "", recentAttachments);

  // Keep the full request bounded even when the conversation contains many prior image uploads.
  let remainingImageSlots = 5;
  const imageSlotsByMessage = new Map<string, number>();
  for (const message of [...userMessagesWithAttachments].reverse()) {
    const imageCount = (message.attachments ?? []).filter((attachment) => attachment.format === "image").length;
    const allowed = Math.min(imageCount, remainingImageSlots);
    if (allowed > 0) imageSlotsByMessage.set(message.id, allowed);
    remainingImageSlots -= allowed;
    if (remainingImageSlots === 0) break;
  }

  return Promise.all(messages.map(async (message) => {
    let images: string[] | undefined;
    const imageLimit = imageSlotsByMessage.get(message.id) ?? 0;
    if (message.role === "user" && selectedIds.has(message.id) && imageLimit > 0) {
      if (message.images?.length) {
        images = message.images.slice(0, imageLimit);
      } else {
        const imageAttachments = (message.attachments ?? [])
          .filter((attachment) => attachment.format === "image" && attachment.id)
          .slice(0, imageLimit);
        const loaded = await Promise.all(imageAttachments.map(async (attachment) => {
          const base64 = attachment.id ? await invokeLoadAttachmentBase64(attachment.id) : null;
          return base64 ?? "";
        }));
        const available = loaded.filter(Boolean);
        if (available.length) images = available;
      }
    }
    return {
      role: message.role,
      content: message.text + (message.id === latestUser?.id ? attachmentContext : ""),
      ...(images?.length ? { images } : {}),
    };
  }));
}

const DEFAULT_SETTINGS: AppSettings = {
  appearance: { bgAnimation: true, reducedMotion: false, theme: "dark", blurIntensity: 50 },
  update: { autoCheck: true, channel: "stable" },
  ai: {
    provider: "local",
    localModel: "",
    routerModel: "",
    thinking: false,
    model: "",
    runtimePolicy: "auto",
    contextWindow: 4096,
    maxOutputTokens: 2048,
    outputLimitMigrationVersion: 2,
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
  const [localModels, setLocalModels] = useState<ModelMeta[]>([]);
  const [routerModels, setRouterModels] = useState<RouterModel[]>([]);
  const [routerConnected, setRouterConnected] = useState(false);
  const [routerBusy, setRouterBusy] = useState(false);
  const [routerError, setRouterError] = useState<string | null>(null);
  const [commandDialog, setCommandDialog] = useState<CommandDialogMode | null>(null);
  const [activeSkillIds, setActiveSkillIds] = useState<SkillId[]>([]);
  const [modelListError, setModelListError] = useState<string | null>(null);
  const [systemReduced, setSystemReduced] = useState(false);
  const [activeConversation, setActiveConversation] = useState<string | null>(null);
  const [memoryPath, setMemoryPath] = useState<string | null>(null);
  const [memoryNotice, setMemoryNotice] = useState<string | null>(null);
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>("idle");
  const [downloadProgress, setDownloadProgress] = useState<UpdateProgressEvent | null>(null);
  const [history, setHistory] = useState<StoredMessage[]>([]);
  const [chatError, setChatError] = useState<string | null>(null);
  const [memoryInitialized, setMemoryInitialized] = useState(false);

  // Parse selected files in memory, then persist accepted bytes to .AzaleaMemory.
  const handleAttachFiles = useCallback(async (fileList: FileList) => {
    const files = Array.from(fileList).slice(0, 5);
    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) {
        const overLimit: Attachment = {
          name: file.name,
          path: file.name,
          size: file.size,
          format: "other",
          error: "Ukuran file melebihi batas 5 MB.",
        };
        setAttachments((previous) => [...previous.filter((item) => item.name !== file.name), overLimit]);
        continue;
      }

      try {
        const parsed = await parseSelectedFile(file);
        const saved = parsed.base64
          ? await invokeSaveAttachmentBytes(file.name, parsed.mimeType, parsed.base64)
          : null;
        const attachment: Attachment = {
          name: file.name,
          path: file.name,
          size: saved?.size ?? file.size,
          format: parsed.format,
          mimeType: saved?.mimeType ?? parsed.mimeType,
          content: parsed.content,
          base64: parsed.format === "image" && !parsed.error ? parsed.base64 : undefined,
          id: saved?.id,
          storagePath: saved?.storagePath,
          error: parsed.error,
          storageWarning: parsed.base64 && !saved
            ? "Lampiran belum tersimpan permanen di .AzaleaMemory; file hanya tersedia selama sesi ini."
            : undefined,
        };
        setAttachments((previous) => [...previous.filter((item) => item.name !== file.name), attachment]);
      } catch (error) {
        const failed: Attachment = {
          name: file.name,
          path: file.name,
          size: file.size,
          format: "other",
          error: error instanceof Error ? error.message : "File tidak dapat dibaca.",
        };
        setAttachments((previous) => [...previous.filter((item) => item.name !== file.name), failed]);
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
  const selectedProviderRef = useRef(settings.ai.provider);
  const routerConnectedRef = useRef(routerConnected);
  const lastAppliedRuntimeConfigRef = useRef<string | null>(null);
  const previousRuntimeGenStateRef = useRef<GenState>("idle");
  const memoryReadyRef = useRef(false);
  const memoryOperationRef = useRef(false);
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

  const refreshLocalModels = useCallback(async (): Promise<ModelMeta[]> => {
    try {
      const available = await invokeListModels();
      setLocalModels(available);
      setModelListError(null);
      return available;
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "Tidak dapat membaca daftar model dari Ollama.";
      setModelListError(message);
      setLocalModels([]);
      return [];
    }
  }, []);

  useEffect(() => {
    void refreshLocalModels();
  }, [refreshLocalModels]);

  useEffect(() => {
    if (view === "local-ai") void refreshLocalModels();
  }, [view, refreshLocalModels]);

  useEffect(() => {
    selectedModelRef.current = settings.ai.model;
    selectedProviderRef.current = settings.ai.provider;
    routerConnectedRef.current = routerConnected;
  }, [settings.ai.model, settings.ai.provider, routerConnected]);

  const refreshRuntimeStatus = useCallback(async () => {
    if (selectedProviderRef.current === "9router") {
      const status = routerConnectedRef.current ? "ready" : "runtime_unavailable";
      setRuntimeStatus(status);
      return status;
    }
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
          // Previous releases defaulted to 512 output tokens, which frequently
          // cut longer answers off mid-sentence. Version the migration so a user
          // can still choose and persist a lower output limit later.
          if (savedAi.outputLimitMigrationVersion !== 2) {
            if (savedAi.maxOutputTokens === 512) savedAi.maxOutputTokens = 2048;
            savedAi.outputLimitMigrationVersion = 2;
          }
          // Drop the previous mock default; installed models now come only from Ollama.
          if (savedAi.model === "gemma4:e2b") savedAi.model = "";
          const savedProvider = savedAi.provider === "9router" ? "9router" : "local";
          const legacyModel = typeof savedAi.model === "string" ? savedAi.model : "";
          if (typeof savedAi.localModel !== "string") savedAi.localModel = savedProvider === "local" ? legacyModel : "";
          if (typeof savedAi.routerModel !== "string") savedAi.routerModel = savedProvider === "9router" ? legacyModel : "";
          // 9Router credentials are intentionally session-only; do not restore an unconnected provider as active.
          if (savedProvider === "9router") {
            savedAi.provider = "local";
            savedAi.model = savedAi.localModel;
          } else {
            savedAi.provider = "local";
            savedAi.model = savedAi.localModel;
          }
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
            attachments: message.attachments,
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
    if (settings.ai.provider === "9router") {
      setRuntimeStatus(routerConnected ? "ready" : "runtime_unavailable");
      return () => { alive = false; };
    }
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
  }, [settings.ai.model, settings.ai.provider, routerConnected]);

  // Refresh model state once a chat ends. A request that starts from "unloaded"
  // still leaves a resident model, and that status is needed to arm the idle timer.
  useEffect(() => {
    const previous = previousRuntimeGenStateRef.current;
    previousRuntimeGenStateRef.current = genState;
    if (previous !== "generating" || genState !== "idle") return;
    if (settings.ai.provider === "9router") {
      setRuntimeStatus(routerConnected ? "ready" : "runtime_unavailable");
      setActiveSkillIds([]);
      return;
    }
    void invokeRuntimeStatus(settings.ai.model).then((status) => {
      if (!status) return;
      setRuntimeStatus(status as RuntimeStatus);
      if (status === "ready") lastActivityRef.current = Date.now();
    });
  }, [genState, settings.ai.model, settings.ai.provider, routerConnected]);

  // Apply persisted or changed runtime policy to a model already loaded in RAM.
  // Defer briefly after chat completion so the backend can remove the terminal stream
  // from its registry before the policy-setting request checks that registry.
  useEffect(() => {
    if (settings.ai.provider !== "local") return;
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
  }, [settings.ai.model, settings.ai.runtimePolicy, settings.ai.provider, runtimeStatus, genState]);

  // ── Runtime lifecycle: automatically unload only after a full idle hour ──
  useEffect(() => {
    if (settings.ai.provider !== "local") return;
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
  }, [settings.ai.provider, settings.ai.runtimePolicy, runtimeStatus, genState, settings.ai.model]);

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
            setActiveSkillIds([]);
            if (chatStartPendingRef.current) cancelledStreamIdsRef.current.set(e.id, true);
            else cancelledStreamIdsRef.current.delete(e.id);
            void refreshRuntimeStatus();
          }
          return;
        }
        if (!mounted) return;
        if (e.id !== streamIdRef.current) return;

        if (e.done) {
          setActiveSkillIds([]);
          // Start a new idle window from the end of a completed or cancelled stream.
          lastActivityRef.current = Date.now();
          // Finalise: mark message as not streaming
          setGenState("idle");
          setStreamIdRef(null);
          finishStream();
          void refreshRuntimeStatus();
          return;
        }

        // Any streamed output confirms the model has finished its initial load.
        if (e.content || e.thinking) setRuntimeStatus("ready");

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
          setActiveSkillIds([]);
          if (chatStartPendingRef.current) cancelledStreamIdsRef.current.set(e.id, true);
          else cancelledStreamIdsRef.current.delete(e.id);
          void refreshRuntimeStatus();
          return;
        }
        if (!mounted || e.id !== streamIdRef.current) return;
        setActiveSkillIds([]);
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
        attachments: message.attachments,
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

  const blurScale = (settings.appearance.blurIntensity / 100) * 2;

  const patchSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((s) => ({ ...s, ...patch }));
  }, []);

  const patchAi = useCallback((patch: Partial<AiSettings>) => {
    setSettings((s) => ({ ...s, ai: { ...s.ai, ...patch } }));
  }, []);

  const selectProvider = useCallback((provider: AiProvider) => {
    if (provider === "9router" && !routerConnected) {
      setCommandDialog("connect");
      setRouterError("Masukkan API key dan hubungkan 9Router sebelum memilih provider ini.");
      return;
    }
    if (provider === "local") {
      const nextModel = settings.ai.localModel || localModels[0]?.id || "";
      patchAi({ provider, model: nextModel, localModel: nextModel });
      return;
    }
    const nextModel = settings.ai.routerModel || routerModels[0]?.id || "";
    patchAi({ provider, model: nextModel, routerModel: nextModel });
  }, [routerConnected, settings.ai.localModel, settings.ai.routerModel, localModels, routerModels, patchAi]);

  const selectModel = useCallback((modelId: string) => {
    if (settings.ai.provider === "9router") {
      patchAi({ model: modelId, routerModel: modelId });
    } else {
      const selected = localModels.find((item) => item.id === modelId);
      patchAi({ model: modelId, localModel: modelId, thinking: selected?.thinking_supported ? settings.ai.thinking : false });
    }
  }, [settings.ai.provider, settings.ai.thinking, localModels, patchAi]);

  const connectRouter = useCallback(async (apiKey: string) => {
    setRouterBusy(true);
    setRouterError(null);
    try {
      const available = await invokeConnect9Router(apiKey);
      setRouterModels(available);
      setRouterConnected(true);
      const nextModel = settings.ai.routerModel && available.some((item) => item.id === settings.ai.routerModel)
        ? settings.ai.routerModel
        : available[0]?.id ?? "";
      patchAi({ provider: "9router", model: nextModel, routerModel: nextModel });
      setCommandDialog(null);
      setRouterError(null);
    } catch (error) {
      setRouterError(error instanceof Error ? error.message : "Koneksi 9Router gagal.");
    } finally {
      setRouterBusy(false);
    }
  }, [settings.ai.routerModel, patchAi]);

  const disconnectRouter = useCallback(async () => {
    try {
      await invokeDisconnect9Router();
      setRouterConnected(false);
      setRouterModels([]);
      setRouterError(null);
      const nextModel = settings.ai.localModel || localModels[0]?.id || "";
      patchAi({ provider: "local", model: nextModel, thinking: false, localModel: nextModel });
      setCommandDialog(null);
    } catch (error) {
      setRouterError(error instanceof Error ? error.message : "Gagal memutuskan koneksi 9Router.");
    }
  }, [settings.ai.localModel, localModels, patchAi]);

  const openSlashCommand = useCallback((command?: string) => {
    const name = command?.trim().split(/\s+/)[0];
    if (name === "/sessions") setCommandDialog("sessions");
    else if (name === "/model") setCommandDialog("model");
    else if (name === "/connect") { setRouterError(null); setCommandDialog("connect"); }
    else setCommandDialog("menu");
  }, []);

  const applyProfile = useCallback((p: ProfileId) => {
    const preset = profileById(p);
    setSettings((s) => ({
      ...s,
      ai: { ...s.ai, profile: p, thinking: preset.thinking, maxOutputTokens: preset.outputTokens },
    }));
  }, []);

  // ── Send message through the active provider ──
  const sendMessage = useCallback(
    async (text: string, attached: Attachment[]): Promise<boolean> => {
      const t = text.trim();
      const provider = settings.ai.provider;
      if (memoryOperationRef.current) {
        setChatError("Penyimpanan lokal sedang dipindahkan atau dicadangkan. Tunggu sampai selesai.");
        return false;
      }
      if (t === "" && attached.length === 0) return false;
      if (!memoryInitialized || !memoryReadyRef.current) {
        setChatError("Penyimpanan lokal masih disiapkan atau tidak tersedia. Tunggu sampai inisialisasi selesai, lalu coba lagi.");
        return false;
      }
      if (provider === "local" && runtimeOperationRef.current) {
        setChatError("Model lokal sedang dimuat atau dilepas dari RAM. Tunggu sampai operasi selesai, lalu coba lagi.");
        return false;
      }
      if (genState !== "idle") return false;
      if (chatStartPendingRef.current) {
        setChatError("Permintaan sebelumnya masih dibatalkan. Tunggu sampai proses itu selesai, lalu coba lagi.");
        return false;
      }

      if (provider === "9router") {
        if (!routerConnected) {
          setChatError("9Router belum terhubung. Gunakan /connect untuk memasukkan API key.");
          setCommandDialog("connect");
          return false;
        }
        if (!settings.ai.model || !routerModels.some((item) => item.id === settings.ai.model)) {
          setChatError("Pilih model 9Router yang tersedia melalui /model.");
          setCommandDialog("model");
          return false;
        }
      } else {
        if (!settings.ai.model || !localModels.some((item) => item.id === settings.ai.model)) {
          setChatError("Belum ada model AI lokal yang dipilih atau model pilihan tidak lagi terpasang. Buka AI Lokal untuk memilih atau mengunduh model.");
          return false;
        }
        if (runtimeStatus !== "ready" && runtimeStatus !== "unloaded") {
          const readinessMessage: Record<RuntimeStatus, string> = {
            not_installed: "Ollama belum terpasang. Pasang Ollama terlebih dahulu untuk memakai chat AI lokal.",
            runtime_unavailable: "Ollama tidak dapat dihubungi. Buka Ollama dan pastikan runtime lokal berjalan, lalu coba lagi.",
            model_not_downloaded: "Model " + settings.ai.model + " belum diunduh. Unduh model tersebut terlebih dahulu, lalu coba lagi.",
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
      }

      setChatError(null);
      const skillIds = detectSkills(t, attached.length > 0, settings.ai.thinking);
      setActiveSkillIds(skillIds);

      const images = attached
        .filter((attachment) => attachment.format === "image" && attachment.base64)
        .map((attachment) => attachment.base64 as string);
      const attachmentMetadata: MessageAttachment[] = attached.map((attachment) => ({
        ...(attachment.id ? { id: attachment.id } : {}),
        name: attachment.name,
        size: attachment.size,
        format: attachment.format,
        mimeType: attachment.mimeType,
        content: attachment.content,
        error: attachment.error,
      }));
      const userMsg: Message = {
        id: uid(),
        role: "user",
        text: t,
        time: clockNow(),
        images: images.length > 0 ? images : undefined,
        attachments: attachmentMetadata,
      };
      const messagesBeforeSend = messagesRef.current;
      lastActivityRef.current = Date.now();
      setMessages((current) => [...current, userMsg]);

      if (provider === "local" && runtimeStatus === "unloaded") setRuntimeStatus("loading");
      setGenState("generating");
      const msgId = uid();
      streamingMsgIdRef.current = msgId;
      setMessages((current) => [
        ...current,
        { id: msgId, role: "assistant", text: "", time: clockNow(), streaming: true },
      ]);

      chatStartPendingRef.current = true;
      cancelBeforeStartRef.current = false;
      let modelMessages: ChatStartPayload["messages"];
      let skillsPrompt = buildSkillsPrompt(skillIds);

      try {
        modelMessages = await buildModelMessages([...messagesBeforeSend, userMsg]);

        // Web Research is an explicit network tool, not a claim that the model browsed.
        if (skillIds.includes("web-research")) {
          try {
            const results = await invokeWebSearch(t);
            const sourceContext = results.length
              ? [
                  "HASIL WEB SEARCH (gunakan tanggal yang tercantum, jangan mengarang tanggal):",
                  ...results.map((item, index) =>
                    (index + 1) + ". " + item.title + "\nURL: " + item.url + "\nRingkasan: " + (item.snippet || "Tidak tersedia.")
                  ),
                  "Cantumkan tautan sumber yang relevan di jawaban akhir dan bedakan fakta sumber dari inferensi.",
                ].join("\n")
              : "Web search tidak menghasilkan hasil yang dapat digunakan. Jelaskan keterbatasan ini; jangan mengklaim browsing berhasil.";
            skillsPrompt = [skillsPrompt, sourceContext].filter(Boolean).join("\n\n");
          } catch (error) {
            skillsPrompt = [
              skillsPrompt,
              "Web search gagal dijalankan: " + (error instanceof Error ? error.message : String(error)) + ". Jangan mengklaim informasi sudah diverifikasi secara online.",
            ].filter(Boolean).join("\n\n");
          }
        }
      } catch {
        chatStartPendingRef.current = false;
        setMessages((current) => current.filter((message) => message.id !== msgId && message.id !== userMsg.id));
        if (streamingMsgIdRef.current === msgId) streamingMsgIdRef.current = null;
        setGenState("idle");
        setActiveSkillIds([]);
        setChatError("Lampiran tidak dapat disiapkan untuk dikirim. Periksa file lalu coba lagi.");
        return false;
      }
      if (cancelBeforeStartRef.current) {
        chatStartPendingRef.current = false;
        cancelBeforeStartRef.current = false;
        streamIdRef.current = null;
        setActiveSkillIds([]);
        return false;
      }

      let id: string | null = null;
      try {
        if (provider === "9router") {
          id = await invokeRouterChatStart({
            model: settings.ai.model,
            messages: modelMessages,
            think: settings.ai.thinking,
            options: {
              temperature: settings.ai.temperature,
              num_predict: settings.ai.maxOutputTokens,
              top_p: settings.ai.topP,
            },
            skillsPrompt,
          });
        } else {
          const payload: ChatStartPayload = {
            model: settings.ai.model,
            messages: skillsPrompt
              ? [{ role: "system", content: skillsPrompt }, ...modelMessages]
              : modelMessages,
            think: settings.ai.thinking,
            runtimePolicy: settings.ai.runtimePolicy,
            options: {
              temperature: settings.ai.temperature,
              num_ctx: settings.ai.contextWindow,
              num_predict: settings.ai.maxOutputTokens,
              top_p: settings.ai.topP,
              top_k: settings.ai.topK,
              repeat_penalty: settings.ai.repeatPenalty,
              stop: settings.ai.stopSequences.split(",").map((value) => value.trim()).filter(Boolean),
              seed: settings.ai.seed,
            },
          };
          id = await invokeChatStart(payload);
        }
      } catch (error) {
        setChatError(error instanceof Error ? error.message : "Gagal memulai permintaan AI.");
      }
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
        setActiveSkillIds([]);
        return false;
      }

      if (!id) {
        // Backend belum menerima pesan: hapus placeholder dan simpan input di composer untuk retry.
        setMessages((current) =>
          current.filter((message) => message.id !== msgId && message.id !== userMsg.id),
        );
        if (streamingMsgIdRef.current === msgId) streamingMsgIdRef.current = null;
        streamIdRef.current = null;
        cancelBeforeStartRef.current = false;
        setGenState("idle");
        setActiveSkillIds([]);
        lastActivityRef.current = Date.now();
        setChatError(provider === "9router"
          ? "AzaleaHouse gagal memulai respons 9Router. Periksa gateway localhost:20128, API key, dan model yang dipilih."
          : "AzaleaHouse gagal memulai respons dari model lokal. Pastikan Ollama aktif dan model tersedia, lalu coba lagi.");
        if (provider === "local") void refreshRuntimeStatus();
        return false;
      }

      streamIdRef.current = id;
      lastActivityRef.current = Date.now();
      if (provider === "local") {
        // The Ollama request itself applied the selected keep-alive policy.
        lastAppliedRuntimeConfigRef.current = settings.ai.model + "|" + settings.ai.runtimePolicy;
      }
      return true;
    },
    [genState, runtimeStatus, settings.ai, localModels, routerModels, routerConnected, refreshRuntimeStatus],
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
    setActiveSkillIds([]);
    setStreamIdRef(null);
  }, []);

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || commandDialog !== null || versionOpen) return;
      if (genState !== "generating" && !chatStartPendingRef.current && streamIdRef.current === null) return;
      event.preventDefault();
      stopGeneration();
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [commandDialog, versionOpen, genState, stopGeneration]);

  // ── Regenerate ──
  const regenerate = useCallback(() => {
    if (memoryOperationRef.current) {
      setMemoryNotice("Selesaikan operasi penyimpanan sebelum membuat ulang respons.");
      return;
    }
    const provider = settings.ai.provider;
    const current = messagesRef.current;
    const last = current[current.length - 1];
    if (!last || last.role !== "assistant" || genState === "generating" || chatStartPendingRef.current) return;

    if (provider === "local") {
      if (runtimeOperationRef.current) {
        setChatError("Model sedang dimuat atau dilepas dari RAM. Tunggu sampai operasi selesai, lalu coba lagi.");
        return;
      }
      if (runtimeStatus !== "ready" && runtimeStatus !== "unloaded") {
        setChatError("Model lokal belum siap. Periksa status Ollama dan model sebelum membuat ulang respons.");
        return;
      }
    } else if (!routerConnected || !routerModels.some((item) => item.id === settings.ai.model)) {
      setChatError("9Router belum terhubung atau model tidak tersedia. Gunakan /connect atau /model.");
      return;
    }

    const userMsg = [...current].reverse().find((message) => message.role === "user");
    if (!userMsg) return;
    const idx = current.lastIndexOf(userMsg);
    const messagesToSend = current.slice(0, idx + 1);
    const skillIds = detectSkills(userMsg.text, Boolean(userMsg.attachments?.length), settings.ai.thinking);
    setActiveSkillIds(skillIds);
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

    chatStartPendingRef.current = true;
    cancelBeforeStartRef.current = false;
    void (async () => {
      try {
        let modelMessages = await buildModelMessages(messagesToSend);
        let skillsPrompt = buildSkillsPrompt(skillIds);
        if (skillIds.includes("web-research")) {
          try {
            const results = await invokeWebSearch(userMsg.text);
            const sourceContext = results.length
              ? [
                  "HASIL WEB SEARCH:",
                  ...results.map((item, index) =>
                    (index + 1) + ". " + item.title + "\nURL: " + item.url + "\nRingkasan: " + (item.snippet || "Tidak tersedia.")
                  ),
                  "Cantumkan tautan sumber di jawaban akhir.",
                ].join("\n")
              : "Pencarian web tidak mengembalikan hasil. Jangan mengklaim browsing berhasil.";
            skillsPrompt = [skillsPrompt, sourceContext].filter(Boolean).join("\n\n");
          } catch (error) {
            skillsPrompt = [skillsPrompt, "Web search gagal: " + (error instanceof Error ? error.message : String(error))].filter(Boolean).join("\n\n");
          }
        }

        if (cancelBeforeStartRef.current) {
          chatStartPendingRef.current = false;
          cancelBeforeStartRef.current = false;
          streamIdRef.current = null;
          setActiveSkillIds([]);
          return;
        }

        let id: string | null = null;
        if (provider === "9router") {
          id = await invokeRouterChatStart({
            model: settings.ai.model,
            messages: modelMessages,
            think: settings.ai.thinking,
            options: {
              temperature: settings.ai.temperature,
              num_predict: settings.ai.maxOutputTokens,
              top_p: settings.ai.topP,
            },
            skillsPrompt,
          });
        } else {
          if (skillsPrompt) modelMessages = [{ role: "system", content: skillsPrompt }, ...modelMessages];
          const payload: ChatStartPayload = {
            model: settings.ai.model,
            messages: modelMessages,
            think: settings.ai.thinking,
            runtimePolicy: settings.ai.runtimePolicy,
            options: {
              temperature: settings.ai.temperature,
              num_ctx: settings.ai.contextWindow,
              num_predict: settings.ai.maxOutputTokens,
              top_p: settings.ai.topP,
              top_k: settings.ai.topK,
              repeat_penalty: settings.ai.repeatPenalty,
              stop: settings.ai.stopSequences.split(",").map((value) => value.trim()).filter(Boolean),
              seed: settings.ai.seed,
            },
          };
          id = await invokeChatStart(payload);
        }

        chatStartPendingRef.current = false;
        if (cancelBeforeStartRef.current || (id && cancelledStreamIdsRef.current.has(id))) {
          cancelBeforeStartRef.current = false;
          if (id) {
            if (cancelledStreamIdsRef.current.get(id) === true) cancelledStreamIdsRef.current.delete(id);
            else {
              cancelledStreamIdsRef.current.set(id, false);
              void invokeChatCancel(id);
            }
          }
          streamIdRef.current = null;
          setActiveSkillIds([]);
          return;
        }
        if (id) {
          streamIdRef.current = id;
          lastActivityRef.current = Date.now();
          if (provider === "local") {
            lastAppliedRuntimeConfigRef.current = settings.ai.model + "|" + settings.ai.runtimePolicy;
          }
          return;
        }

        cancelBeforeStartRef.current = false;
        lastActivityRef.current = Date.now();
        setMessages((messages) => messages.filter((message) => message.id !== msgId));
        if (streamingMsgIdRef.current === msgId) streamingMsgIdRef.current = null;
        streamIdRef.current = null;
        setGenState("idle");
        setActiveSkillIds([]);
        setChatError(provider === "9router"
          ? "Gagal membuat ulang respons melalui 9Router. Periksa gateway dan model."
          : "AzaleaHouse gagal membuat ulang respons dari model lokal. Periksa Ollama lalu coba lagi.");
        if (provider === "local") void refreshRuntimeStatus();
      } catch (error) {
        chatStartPendingRef.current = false;
        cancelBeforeStartRef.current = false;
        if (streamingMsgIdRef.current === msgId) streamingMsgIdRef.current = null;
        setMessages((messages) => messages.filter((message) => message.id !== msgId));
        setGenState("idle");
        setActiveSkillIds([]);
        setChatError(error instanceof Error ? error.message : "Lampiran tidak dapat disiapkan untuk membuat ulang respons.");
      }
    })();
  }, [genState, runtimeStatus, settings.ai, routerConnected, routerModels, refreshRuntimeStatus]);

  // ── New chat ──
  const newChat = useCallback(() => {
    if (memoryOperationRef.current) {
      setMemoryNotice("Selesaikan operasi penyimpanan sebelum membuat percakapan baru.");
      return;
    }
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
    if (memoryOperationRef.current) {
      setMemoryNotice("Selesaikan operasi penyimpanan sebelum membuka percakapan lain.");
      return;
    }
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
        attachments: message.attachments,
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
    if (memoryOperationRef.current) {
      setMemoryNotice("Selesaikan operasi penyimpanan sebelum menghapus percakapan.");
      return;
    }
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

  const installedModel = localModels.find((item) => item.id === settings.ai.model);
  const selectedRouterModel = routerModels.find((item) => item.id === settings.ai.model);
  const model = settings.ai.provider === "9router"
    ? {
        id: settings.ai.model,
        name: selectedRouterModel?.name || selectedRouterModel?.id || "Pilih model 9Router",
        thinkingSupported: routerConnected,
        note: "Model dari 9Router",
      }
    : installedModel
      ? {
          id: installedModel.id,
          name: installedModel.name,
          thinkingSupported: installedModel.thinking_supported,
          note: installedModel.note,
        }
      : {
          id: settings.ai.model,
          name: settings.ai.model,
          thinkingSupported: false,
          note: "Belum terpasang di Ollama lokal",
        };
  const activeModelOptions = settings.ai.provider === "9router"
    ? routerModels.map((item) => ({ id: item.id, name: item.name || item.id }))
    : localModels.map((item) => ({ id: item.id, name: item.name }));
  const activeRuntimeStatus: RuntimeStatus = settings.ai.provider === "9router"
    ? (routerConnected ? "ready" : "runtime_unavailable")
    : runtimeStatus;

  // ── Manual model unload ──
  const unloadModel = useCallback(async () => {
    if (settings.ai.provider !== "local") return;
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
  }, [genState, runtimeStatus, settings.ai.provider, settings.ai.model]);

  // ── Memory operations (Phase 1 hardening / Phase 4 storage) ──
  const openMemoryFolder = useCallback(async () => {
    const opened = await invokeOpenMemoryFolder();
    setMemoryNotice(opened
      ? "Folder memori dibuka di File Explorer."
      : "Folder memori tidak dapat dibuka. Periksa lokasi penyimpanan.");
  }, []);

  const changeMemoryPath = useCallback(async () => {
    if (memoryOperationRef.current) return;
    memoryOperationRef.current = true;
    try {
      const selectedParent = await invokePickMemoryParentFolder();
      if (!selectedParent) return;
      setMemoryBusy(true);
      if (genState !== "idle") throw new Error("Selesaikan generasi chat yang sedang berjalan sebelum memindahkan memori.");
      const saved = await persistConversation();
      if (!saved) throw new Error("Percakapan aktif belum berhasil disimpan. Pemindahan dibatalkan.");
      setMemoryNotice("Memvalidasi lokasi, membuat cadangan, dan menyalin data memori...");
      await invokeSetCustomPath(selectedParent);
      const activePath = await invokeMemoryPath();
      if (!activePath) throw new Error("Lokasi memori aktif tidak dapat dibaca setelah migrasi.");
      setMemoryPath(activePath);
      setMemoryNotice(`Lokasi memori berhasil dipindahkan ke ${activePath}. Data sumber lama tidak dihapus.`);
    } catch (error) {
      setMemoryNotice(`Gagal memindahkan lokasi memori: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      memoryOperationRef.current = false;
      setMemoryBusy(false);
    }
  }, [genState, persistConversation]);

  const backupMemory = useCallback(async () => {
    if (memoryOperationRef.current) return;
    memoryOperationRef.current = true;
    setMemoryBusy(true);
    try {
      if (genState !== "idle") throw new Error("Selesaikan generasi chat yang sedang berjalan sebelum membuat cadangan.");
      const saved = await persistConversation();
      if (!saved) throw new Error("Percakapan aktif belum berhasil disimpan. Cadangan dibatalkan.");
      const backupPath = await invokeBackupMemory();
      if (!backupPath) throw new Error("Lokasi cadangan tidak dikembalikan oleh backend.");
      setMemoryNotice(`Cadangan memori dibuat di: ${backupPath}`);
    } catch (error) {
      setMemoryNotice(`Gagal membuat cadangan memori: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      memoryOperationRef.current = false;
      setMemoryBusy(false);
    }
  }, [genState, persistConversation]);

  // ── Update operations (Phase 7) ──
  const checkForUpdate = useCallback(async () => {
    setUpdateStatus("checking");
    try {
      const info = await invokeCheckUpdate();
      if (!info) {
        setUpdateInfo({
          available: false,
          current_version: appVersion,
          latest_version: appVersion,
          body: "",
          assets: [],
          error: "Pemeriksaan pembaruan hanya tersedia di aplikasi desktop.",
        });
        setUpdateStatus("offline");
        return;
      }
      setUpdateInfo(info);
      if (info.error) {
        setUpdateStatus("offline");
      } else if (info.available) {
        setUpdateStatus("update_available");
      } else {
        setUpdateStatus("up_to_date");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setUpdateInfo((previous) => ({
        available: false,
        current_version: previous?.current_version ?? appVersion,
        latest_version: previous?.latest_version ?? appVersion,
        body: previous?.body ?? "",
        assets: [],
        error: message || "Pemeriksaan pembaruan gagal.",
      }));
      setUpdateStatus("offline");
    }
  }, [appVersion]);

  const downloadUpdate = useCallback(async () => {
    if (!updateInfo || updateInfo.assets.length === 0) return;
    const asset = updateInfo.assets[0];
    if (!asset) return;
    setDownloadProgress(null);
    setUpdateInfo((previous) => previous ? { ...previous, error: null } : previous);
    setUpdateStatus("downloading");
    try {
      await invokeDownloadUpdate(asset.url, asset.name);
      setUpdateStatus("downloaded");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setDownloadProgress(null);
      if (/dibatalkan/i.test(message)) {
        setUpdateStatus("idle");
        return;
      }
      setUpdateInfo((previous) => previous ? { ...previous, error: message || "Unduhan pembaruan gagal." } : previous);
      setUpdateStatus("error");
    }
  }, [updateInfo]);

  const cancelDownload = useCallback(async () => {
    const accepted = await invokeCancelDownload();
    if (!accepted) {
      setUpdateInfo((previous) => previous ? { ...previous, error: "Permintaan pembatalan unduhan gagal." } : previous);
      setUpdateStatus("error");
    }
  }, []);

  const installUpdate = useCallback(async () => {
    setUpdateStatus("installing");
    setUpdateInfo((previous) => previous ? { ...previous, error: null } : previous);
    try {
      await invokeInstallUpdate();
      // The Rust command starts the installer and requests application exit.
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setUpdateInfo((previous) => previous ? { ...previous, error: message || "Installer gagal dijalankan." } : previous);
      setUpdateStatus("error");
    }
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
      <div
        className={rootClass + (settings.appearance.theme === "light" ? " app--light" : " app--dark")}
        style={{ "--blur-scale": String(blurScale) } as React.CSSProperties}
        data-theme={settings.appearance.theme}
      >
        <BackgroundLayer animated={animAllowed} theme={settings.appearance.theme} />

        <Sidebar
        view={view}
        onNavigate={setView}
        onNewChat={newChat}
        runtimeStatus={settings.ai.provider === "local" ? runtimeStatus : "runtime_unavailable"}
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
              modelName={model?.name ?? settings.ai.model}
              modelId={settings.ai.model}
              availableModels={activeModelOptions}
              provider={settings.ai.provider}
              onModelChange={selectModel}
              onOpenCommands={openSlashCommand}
              onOpenLocalAi={() => setView("local-ai")}
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
              runtimeStatus={activeRuntimeStatus}
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
              availableModels={localModels}
              onChange={patchSettings}
              onBack={() => setView("chat")}
              runtimeStatus={runtimeStatus}
              onUnloadModel={unloadModel}
              modelBusy={genState === "generating" || runtimeStatus === "unloading"}
              memoryPath={memoryPath}
              memoryNotice={memoryNotice}
              memoryBusy={memoryBusy}
              onOpenMemoryFolder={openMemoryFolder}
              onChangeMemoryPath={changeMemoryPath}
              onBackupMemory={backupMemory}
            />
          </div>
        ) : null}

        {view === "local-ai" ? (
          <div className="view-fade">
            <LocalAiView
              models={localModels}
              modelListError={modelListError}
              runtimeStatus={runtimeStatus}
              selectedModel={settings.ai.localModel}
              onRefreshModels={refreshLocalModels}
              onUseModel={(modelId) => {
                const nextModel = localModels.find((item) => item.id === modelId);
                patchAi({
                  provider: "local",
                  model: modelId,
                  localModel: modelId,
                  thinking: nextModel?.thinking_supported ? settings.ai.thinking : false,
                });
                setView("chat");
              }}
              onBackToChat={() => setView("chat")}
              onModelDeleted={(modelId) => {
                if (settings.ai.localModel === modelId) {
                  patchAi({ localModel: "", ...(settings.ai.provider === "local" ? { model: "" } : {}), thinking: false });
                }
              }}
              modelBusy={genState !== "idle" || runtimeStatus === "loading" || runtimeStatus === "unloading"}
            />
          </div>
        ) : null}

        {view === "documents" ? (
          <div className="view-fade">
            <DocumentsView />
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
          localModels={localModels}
          routerModels={routerModels}
          routerConnected={routerConnected}
          activeSkillIds={activeSkillIds}
          onChange={(patch) => {
            if (typeof patch.model === "string") selectModel(patch.model);
            else patchAi(patch);
          }}
          onProviderChange={selectProvider}
          onOpenConnect={() => { setRouterError(null); setCommandDialog("connect"); }}
          onDisconnect={disconnectRouter}
          onOpenAdvanced={() => setView("settings")}
        />
      ) : null}

      {memoryBusy ? (
        <div className="memory-operation-overlay" role="status" aria-live="polite">
          <div className="memory-operation-card">
            <span className="memory-operation-spinner" aria-hidden="true" />
            <strong>Operasi penyimpanan lokal</strong>
            <p>Menyalin atau mencadangkan .AzaleaMemory. Jangan tutup aplikasi sampai proses selesai.</p>
          </div>
        </div>
      ) : null}

      <CommandDialog
        mode={commandDialog}
        provider={settings.ai.provider}
        connected={routerConnected}
        models={activeModelOptions}
        selectedModel={settings.ai.model}
        history={history}
        busy={routerBusy}
        error={routerError}
        onClose={() => setCommandDialog(null)}
        onModeChange={(mode) => setCommandDialog(mode)}
        onProviderChange={selectProvider}
        onModelChange={(modelId) => { selectModel(modelId); setCommandDialog(null); }}
        onConnect={connectRouter}
        onDisconnect={disconnectRouter}
        onOpenSession={(id) => { setCommandDialog(null); void openConversation(id); }}
        onDeleteSession={(id) => { void deleteConversation(id); }}
      />

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
        onInstall={installUpdate}
      />
      </div>
    </ErrorBoundary>
  );
}
