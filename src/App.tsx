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
  mockConversation,
  mockReplies,
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
  invokeBackupMemory,
  invokeCheckUpdate,
  invokeDownloadUpdate,
  invokeCancelDownload,
  invokeApplyUpdate,
  listenUpdateProgress,
  invokeUnloadModel,
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
  const [messages, setMessages] = useState<Message[]>(() =>
    mockConversation.map((m) => ({ ...m, id: uid() })),
  );
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
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>("idle");
  const [downloadProgress, setDownloadProgress] = useState<UpdateProgressEvent | null>(null);
  const [history, setHistory] = useState<StoredMessage[]>([]);

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
  const messagesRef = useRef<Message[]>([]);
  const eventCleanupRef = useRef<(() => void) | null>(null);
  const replyIndexRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const keepaliveTimerRef = useRef<number | null>(null);
  const lastActivityRef = useRef(0);
  const memoryReadyRef = useRef(false);

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

  // Bersihkan timer mock saat unmount
  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  // Mirror messages to ref for chat_start payload
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // ── Initialize memory dir + load saved settings + restore session ──
  useEffect(() => {
    let alive = true;
    // Ensure .AzaleaMemory exists
    invokeEnsureMemoryDir().then(() => {
      if (alive) memoryReadyRef.current = true;
    });

    // Load memory path
    invokeMemoryPath().then((p) => {
      if (alive && p) setMemoryPath(p);
    });

    // Load saved settings
    invokeLoadSettings().then((saved) => {
      if (alive && saved) {
        if (saved.appearance) {
          setSettings((s) => ({ ...s, appearance: { ...s.appearance, ...(saved.appearance as Record<string, unknown>) } }));
        }
        if (saved.ai) {
          setSettings((s) => ({ ...s, ai: { ...s.ai, ...(saved.ai as Record<string, unknown>) } }));
        }
      }
    });

    // Phase 6: Restore last session
    invokeListConversations().then((list) => {
      if (!alive || list.length === 0) return;
      // Get the most recently updated conversation
      const last = list[0];
      if (!last) return;
      invokeLoadConversation(last.id).then((conv) => {
        if (alive && conv) {
          setActiveConversation(conv.id);
          setMessages(
            conv.messages.map((m) => ({
              id: m.id,
              role: m.role,
              text: m.text,
              time: m.time,
              thinking: m.thinking,
              streaming: false,
            }))
          );
        }
      });
    });
  }, []);

  // ── Fetch runtime status on mount & model change ──
  useEffect(() => {
    let alive = true;
    invokeRuntimeStatus(settings.ai.model).then((status) => {
      if (alive && status) setRuntimeStatus(status as RuntimeStatus);
    });
    return () => {
      alive = false;
    };
  }, [settings.ai.model]);

  // ── Keep-alive timer (Fase 3): auto-unload 1h idle in automatic mode ──
  useEffect(() => {
    // Only active in automatic mode & when model is loaded
    if (settings.ai.runtimePolicy !== "auto") return;
    if (runtimeStatus !== "ready") return;
    if (genState === "generating") return;

    keepaliveTimerRef.current = window.setInterval(() => {
      const elapsed = Date.now() - lastActivityRef.current;
      // 1 hour (3600000ms) idle → unload
      if (elapsed >= 3_600_000) {
        invokeUnloadModel(settings.ai.model).then(() => {
          invokeRuntimeStatus(settings.ai.model).then((status) => {
            if (status) setRuntimeStatus(status as RuntimeStatus);
          });
        });
        // Clear timer; will re-arm on next activity
        if (keepaliveTimerRef.current) {
          clearInterval(keepaliveTimerRef.current);
          keepaliveTimerRef.current = null;
        }
      }
    }, 60_000); // check every minute

    return () => {
      if (keepaliveTimerRef.current) {
        clearInterval(keepaliveTimerRef.current);
        keepaliveTimerRef.current = null;
      }
    };
  }, [settings.ai.runtimePolicy, runtimeStatus, genState, settings.ai.model]);

  // ── Set up SSE event listeners once ──
  useEffect(() => {
    let mounted = true;
    listenChatEvents({
      onStarted: (e) => {
        // Set stream ID from event so chunks arriving before Promise resolution aren't dropped
        streamIdRef.current = e.id;
      },
      onChunk: (e) => {
        if (!mounted) return;
        if (e.id !== streamIdRef.current) return;

        if (e.done) {
          // Finalise: mark message as not streaming
          setGenState("idle");
          setStreamIdRef(null);
          finishStream();
          void persistConversation();
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
              if (e.thinking) {
                updated.thinking = (msg.thinking || "") + e.thinking;
              }
              return updated;
            }
            return msg;
          }),
        );
      },
      onError: (e) => {
        if (!mounted || e.id !== streamIdRef.current) return;
        setMessages((m) =>
          m.map((msg) =>
            msg.id === streamingMsgIdRef.current
              ? {
                  ...msg,
                  text: e.message,
                  streaming: false,
                }
              : msg,
          ),
        );
        setGenState("idle");
        setStreamIdRef(null);
        finishStream();
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

  /// Persist current messages to .AzaleaMemory.
  async function persistConversation() {
    if (!memoryReadyRef.current) return;
    const convId = activeConversation ?? uid();
    if (!activeConversation) setActiveConversation(convId);
    const stored: { id: string; title: string; updated_at: string; messages: StoredMessage[] } = {
      id: convId,
      title: titleFromMessages(messagesRef.current),
      updated_at: clockNow(),
      messages: messagesRef.current.map((m) => ({
        id: m.id,
        role: m.role,
        text: m.text,
        time: m.time,
        thinking: m.thinking,
      })),
    };
    await invokeSaveConversation(stored);
    // Refresh list (future: display in history view)
    void invokeListConversations();
  }

  /// Save settings whenever they change (debounced via useEffect).
  useEffect(() => {
    if (!memoryReadyRef.current) return;
    invokeSaveSettings(settings).catch(() => { /* ignore */ });
  }, [settings.ai, settings.appearance]);

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

  // ── Send message ──
  const sendMessage = useCallback(
    (text: string, attached: Attachment[]) => {
      const t = text.trim();
      if (t === "" && attached.length === 0) return;
      if (genState !== "idle") return;

      // Build attachment content to include in the prompt
      let attachmentContext = "";
      const images: string[] = [];
      for (const a of attached) {
        if (a.format === "image" && a.base64) {
          images.push(a.base64);
        }
        if (a.content) {
          attachmentContext += `\n\n--- Lampiran: ${a.name} ---\n${a.content.slice(0, 4000)}\n---`;
        }
        if (a.error) {
          attachmentContext += `\n\n[Lampiran: ${a.name} — ${a.error}]`;
        }
      }

      const fullText = t + attachmentContext;
      const userMsg: Message = { id: uid(), role: "user", text: fullText, time: clockNow() };
      setMessages((m) => [...m, userMsg]);

      // Runtime ready atau unloaded (Ollama auto-loads on demand) → real streaming
      if (runtimeStatus === "ready" || runtimeStatus === "unloaded") {
        setGenState("generating");
        const msgId = uid();
        streamingMsgIdRef.current = msgId;
        setMessages((m) => [...m, { id: msgId, role: "assistant", text: "", time: clockNow(), streaming: true }]);

        const payload: ChatStartPayload = {
          model: settings.ai.model,
          messages: [...messagesRef.current, { ...userMsg, images }].map((m) => ({
            role: m.role,
            content: m.text,
            images: m.images,
          })).filter((m) => m.images === undefined || m.images.length > 0 || true),
          think: settings.ai.thinking,
          options: {
            temperature: settings.ai.temperature,
            num_ctx: settings.ai.contextWindow,
            num_predict: settings.ai.maxOutputTokens,
            top_p: settings.ai.topP,
            top_k: settings.ai.topK,
            repeat_penalty: settings.ai.repeatPenalty,
            stop: settings.ai.stopSequences
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
            seed: settings.ai.seed,
          },
        };

        invokeChatStart(payload).then((id) => {
          if (id) {
            streamIdRef.current = id;
            lastActivityRef.current = Date.now();
          } else {
            // Backend call failed → fall back to mock
            fallbackMock(msgId);
          }
        });
        return;
      }

      // Runtime not ready → mock preview
      fallbackMock(uid());
    },
    [genState, runtimeStatus, settings.ai],
  );

  /** Simpan fallback mock ke dalam pesan asisten */
  function fallbackMock(replaceId?: string) {
    setGenState("thinking");
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      const reply = mockReplies[replyIndexRef.current % mockReplies.length] ?? mockReplies[0] ?? "";
      replyIndexRef.current += 1;
      const replyMsg: Message = { id: uid(), role: "assistant", text: reply, time: clockNow() };
      if (replaceId) {
        // Replace the placeholder streaming message
        setMessages((m) =>
          m.map((msg) => (msg.id === replaceId ? { ...msg, text: reply, streaming: false } : msg)),
        );
        streamingMsgIdRef.current = null;
      } else {
        setMessages((m) => [...m, replyMsg]);
      }
      setGenState("idle");
      void persistConversation();
    }, 1100);
  }

  // ── Stop / cancel ──
  const stopGeneration = useCallback(() => {
    // Real stream
    if (streamIdRef.current) {
      invokeChatCancel(streamIdRef.current);
      finishStream();
    }
    // Mock timer
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setGenState("idle");
    setStreamIdRef(null);
    setMessages((m) =>
      m.map((msg) =>
        msg.id === streamingMsgIdRef.current
          ? { ...msg, text: msg.text + "*Generasi dihentikan.*", streaming: false }
          : msg,
      ),
    );
    streamingMsgIdRef.current = null;
  }, []);

  // ── Regenerate ──
  const regenerate = useCallback(() => {
    const current = messagesRef.current;
    const last = current[current.length - 1];
    if (!last || last.role !== "assistant" || genState === "generating") return;

    if (runtimeStatus === "ready" || runtimeStatus === "unloaded") {
      // Cari pesan user terakhir yang dikirim
      const userMsg = [...current].reverse().find((x) => x.role === "user");
      if (!userMsg) return;

      const idx = current.lastIndexOf(userMsg);
      const msgsToSend = current.slice(0, idx + 1);

      // Hapus balasan asisten, tambahkan placeholder streaming
      setMessages((m) => [...m.slice(0, idx + 1)]);
      setGenState("generating");
      const msgId = uid();
      streamingMsgIdRef.current = msgId;
      setMessages((m) => [...m, { id: msgId, role: "assistant", text: "", time: clockNow(), streaming: true }]);

      const payload: ChatStartPayload = {
        model: settings.ai.model,
        messages: msgsToSend.map((m) => ({ role: m.role, content: m.text })),
        think: settings.ai.thinking,
        options: {
          temperature: settings.ai.temperature,
          num_ctx: settings.ai.contextWindow,
          num_predict: settings.ai.maxOutputTokens,
          top_p: settings.ai.topP,
          top_k: settings.ai.topK,
          repeat_penalty: settings.ai.repeatPenalty,
          stop: settings.ai.stopSequences
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          seed: settings.ai.seed,
        },
      };

      invokeChatStart(payload).then((id) => {
        if (id) {
          streamIdRef.current = id;
        } else {
          fallbackMock(msgId);
        }
      });
    } else {
      // Mock regenerate
      const reply = mockReplies[replyIndexRef.current % mockReplies.length] ?? last.text;
      replyIndexRef.current += 1;
      setMessages((m) => [...m.slice(0, -1), { ...last, text: reply }]);
    }
  }, [genState, runtimeStatus, settings.ai]);

  // ── New chat ──
  const newChat = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (streamIdRef.current) {
      invokeChatCancel(streamIdRef.current);
    }
    // Save current conversation before clearing
    void persistConversation();
    setGenState("idle");
    setStreamIdRef(null);
    streamingMsgIdRef.current = null;
    setActiveConversation(uid());
    setMessages([]);
    setAttachments([]);
    setView("chat");
  }, []);

  // ── Load conversation from history (Phase 6) ──
  const openConversation = useCallback(async (id: string) => {
    const conv = await invokeLoadConversation(id);
    if (conv) {
      setActiveConversation(conv.id);
      setMessages(
        conv.messages.map((m) => ({
          id: m.id,
          role: m.role,
          text: m.text,
          time: m.time,
          thinking: m.thinking,
          streaming: false,
        }))
      );
      setAttachments([]);
      setView("chat");
    }
  }, []);

  // ── Delete conversation from history (Phase 6) ──
  const deleteConversation = useCallback(async (id: string) => {
    await invokeDeleteConversation(id);
    const list = await invokeListConversations();
    setHistory(list.map((c) => ({
      id: c.id,
      role: "user" as const,
      text: c.title,
      time: c.updated_at,
    })));
  }, []);

  const model = models.find((m) => m.id === settings.ai.model) ?? models[0];

  // ── Manual model unload (Fase 3) ──
  const unloadModel = useCallback(() => {
    if (runtimeStatus !== "ready" && runtimeStatus !== "unloaded") return;
    invokeUnloadModel(settings.ai.model).then((ok) => {
      if (ok) {
        keepaliveTimerRef.current = null;
        invokeRuntimeStatus(settings.ai.model).then((status) => {
          if (status) setRuntimeStatus(status as RuntimeStatus);
        });
      }
    });
  }, [runtimeStatus, settings.ai.model]);

  // ── Memory operations (Fase 4) ──
  const openMemoryFolder = useCallback(() => {
    void invokeOpenMemoryFolder();
  }, []);

  const changeMemoryPath = useCallback(async () => {
    // Di MVP, gunakan dialog folder native via Rust set_custom_path.
    // Frontend tidak bisa membuka dialog folder; Rust akan menangani via
    // invoke as part of migration flow in a future iteration.
    const newPath = memoryPath; // placeholder — dialog akan ditambahkan
    void newPath;
  }, [memoryPath]);

  const backupMemory = useCallback(() => {
    void invokeBackupMemory();
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

  const applyUpdate = useCallback(async () => {
    if (downloadProgress && updateInfo && updateInfo.assets.length > 0) {
      const asset = updateInfo.assets[0];
      if (asset) {
        await invokeApplyUpdate(asset.name);
      }
    }
  }, [updateInfo, downloadProgress]);

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
              onStop={stopGeneration}
              onRegenerate={regenerate}
              thinking={settings.ai.thinking}
              onToggleThinking={() => patchAi({ thinking: !settings.ai.thinking })}
              thinkingSupported={model?.thinkingSupported ?? true}
              profile={settings.ai.profile}
              onProfileChange={applyProfile}
              runtimeStatus={runtimeStatus}
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
              memoryPath={memoryPath}
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
        onApply={applyUpdate}
      />
      </div>
    </ErrorBoundary>
  );
}
