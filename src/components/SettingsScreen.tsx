import type { AppSettings, ProfileId, RuntimeStatus } from "../types";
import { MEMORY_PATH, contextOptions, models, outputOptions, profiles } from "../data/mock";
import { decimalID } from "../lib/format";
import { FieldRow, Segmented, Slider, Switch } from "./Controls";
import { IconArrowLeft, IconFolder, IconLock, IconRefresh } from "./Icons";

export function SettingsScreen({
  settings,
  onChange,
  onBack,
  runtimeStatus,
  onUnloadModel,
  modelBusy,
  memoryPath,
  onOpenMemoryFolder,
  onChangeMemoryPath,
  onBackupMemory,
}: {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
  onBack: () => void;
  runtimeStatus?: RuntimeStatus;
  onUnloadModel?: () => void;
  modelBusy?: boolean;
  memoryPath?: string | null;
  onOpenMemoryFolder?: () => void;
  onChangeMemoryPath?: () => void;
  onBackupMemory?: () => void;
}) {
  const { appearance, ai } = settings;
  const model = models.find((m) => m.id === ai.model) ?? models[0];

  return (
    <div className="settings-screen">
      <div className="settings-inner">
        <div className="settings-header">
          <button type="button" className="btn" onClick={onBack}>
            <IconArrowLeft size={16} />
            Kembali ke Chat
          </button>
          <h1 className="settings-title">Pengaturan</h1>
        </div>

        <section className="settings-section" aria-labelledby="sec-memori">
          <h2 className="panel-title" id="sec-memori">
            Memori
          </h2>
          <FieldRow
            label="Lokasi memori"
            desc="Folder khusus data percakapan dan memori AzaleaHouse."
            stacked
            control={<code className="path-chip">{memoryPath ?? MEMORY_PATH}</code>}
          />
          <div className="settings-actions">
            <button type="button" className="btn" onClick={onOpenMemoryFolder} title="Buka folder di Explorer">
              <IconFolder size={15} />
              Buka Folder
            </button>
            <button type="button" className="btn" onClick={onChangeMemoryPath} title="Pindahkan folder memori">
              <IconRefresh size={15} />
              Ubah Lokasi
            </button>
            <button type="button" className="btn" onClick={onBackupMemory} title="Cadangkan data">
              <IconLock size={15} />
              Backup
            </button>
          </div>
        </section>

        <section className="settings-section" aria-labelledby="sec-tampilan">
          <h2 className="panel-title" id="sec-tampilan">
            Tampilan
          </h2>
          <FieldRow
            label="Animasi latar"
            desc="Gerakan lembut pada langit dan kerlip bintang. Matikan untuk perangkat lambat."
            control={
              <Switch
                checked={appearance.bgAnimation}
                onChange={(v) => onChange({ appearance: { ...appearance, bgAnimation: v } })}
                ariaLabel="Animasi latar"
              />
            }
          />
          <FieldRow
            label="Kurangi gerakan"
            desc="Matikan semua animasi latar, termasuk mengikuti preferensi sistem."
            control={
              <Switch
                checked={appearance.reducedMotion}
                onChange={(v) => onChange({ appearance: { ...appearance, reducedMotion: v } })}
                ariaLabel="Kurangi gerakan"
              />
            }
          />
          <FieldRow
            label="Intensitas blur"
            desc="Seberapa pekat efek kaca pada panel."
            stacked
            control={
              <div className="slider-row">
                <Slider
                  min={0}
                  max={100}
                  step={5}
                  value={appearance.blurIntensity}
                  onChange={(v) => onChange({ appearance: { ...appearance, blurIntensity: v } })}
                  ariaLabel="Intensitas blur"
                />
                <span className="field-value">{appearance.blurIntensity}%</span>
              </div>
            }
          />
        </section>

        <section className="settings-section" aria-labelledby="sec-ai">
          <h2 className="panel-title" id="sec-ai">
            Default AI
          </h2>
          <FieldRow
            label="Model"
            desc={model?.name}
            stacked
            control={
              <select
                className="select select--full"
                value={ai.model}
                onChange={(e) => onChange({ ai: { ...ai, model: e.target.value as typeof ai.model } })}
                aria-label="Model"
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            }
          />
          <FieldRow
            label="Thinking default"
            desc="Aktifkan penalaran internal sebelum menjawab."
            control={
              <Switch
                checked={ai.thinking}
                onChange={(v) => onChange({ ai: { ...ai, thinking: v } })}
                ariaLabel="Thinking default"
                disabled={!model?.thinkingSupported}
              />
            }
          />
          <FieldRow
            label="Kebijakan runtime"
            stacked
            control={
              <Segmented
                ariaLabel="Kebijakan runtime"
                value={ai.runtimePolicy}
                onChange={(v) => onChange({ ai: { ...ai, runtimePolicy: v } })}
                options={[
                  { value: "auto", label: "Otomatis — 1 jam" },
                  { value: "manual", label: "Manual" },
                ]}
              />
            }
          />
          {(runtimeStatus === "ready" || runtimeStatus === "unloaded" || runtimeStatus === "loading" || runtimeStatus === "unloading") ? (
            <FieldRow
              label="Status model"
              desc={
                runtimeStatus === "ready"
                  ? "Model dimuat di RAM dan siap digunakan."
                  : runtimeStatus === "loading"
                    ? "Kebijakan runtime atau status model sedang diperbarui."
                    : runtimeStatus === "unloading"
                      ? "Model sedang dilepas dari RAM."
                      : "Model tidak berada di RAM; Ollama akan memuatnya saat diperlukan."
              }
              control={
                runtimeStatus === "ready" && onUnloadModel ? (
                  <button
                    type="button"
                    className="btn btn--sm btn--danger"
                    onClick={onUnloadModel}
                    disabled={modelBusy}
                  >
                    {modelBusy ? "Sedang bekerja…" : "Matikan"}
                  </button>
                ) : (
                  <span className="field-value">
                    {runtimeStatus === "loading" ? "Memuat…" : runtimeStatus === "unloading" ? "Melepas…" : "Tidak dimuat"}
                  </span>
                )
              }
            />
          ) : null}
          <FieldRow
            label="Profil default"
            control={
              <select
                className="select"
                value={ai.profile}
                onChange={(e) => onChange({ ai: { ...ai, profile: e.target.value as ProfileId } })}
                aria-label="Profil default"
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            }
          />
          <FieldRow
            label="Context window"
            control={
              <select
                className="select"
                value={ai.contextWindow}
                onChange={(e) => onChange({ ai: { ...ai, contextWindow: Number(e.target.value) } })}
                aria-label="Context window"
              >
                {contextOptions.map((c) => (
                  <option key={c} value={c}>
                    {c.toLocaleString("id-ID")} token
                  </option>
                ))}
              </select>
            }
          />
          <FieldRow
            label="Batas output"
            control={
              <select
                className="select"
                value={ai.maxOutputTokens}
                onChange={(e) =>
                  onChange({ ai: { ...ai, maxOutputTokens: Number(e.target.value) } })
                }
                aria-label="Batas output"
              >
                {outputOptions.map((o) => (
                  <option key={o} value={o}>
                    {o.toLocaleString("id-ID")} token
                  </option>
                ))}
              </select>
            }
          />
          <FieldRow
            label="Temperature"
            stacked
            control={
              <div className="slider-row">
                <Slider
                  min={0}
                  max={1.5}
                  step={0.1}
                  value={ai.temperature}
                  onChange={(v) => onChange({ ai: { ...ai, temperature: Math.round(v * 10) / 10 } })}
                  ariaLabel="Temperature"
                />
                <span className="field-value">{decimalID(ai.temperature)}</span>
              </div>
            }
          />
        </section>

        <section className="settings-section" aria-labelledby="sec-advanced">
          <h2 className="panel-title" id="sec-advanced">Parameter lanjutan</h2>
          <FieldRow
            label="Top-P"
            desc="Nucleus sampling (0-1). Nilai rendah = fokus, tinggi = variatif."
            stacked
            control={
              <div className="slider-row">
                <Slider
                  min={0}
                  max={1}
                  step={0.05}
                  value={ai.topP}
                  onChange={(v) => onChange({ ai: { ...ai, topP: Math.round(v * 100) / 100 } })}
                  ariaLabel="Top-P"
                />
                <span className="field-value">{decimalID(ai.topP)}</span>
              </div>
            }
          />
          <FieldRow
            label="Top-K"
            desc="Token kandidat teratas yang dipertimbangkan."
            stacked
            control={
              <div className="slider-row">
                <Slider
                  min={0}
                  max={100}
                  step={8}
                  value={ai.topK}
                  onChange={(v) => onChange({ ai: { ...ai, topK: Math.round(v) } })}
                  ariaLabel="Top-K"
                />
                <span className="field-value">{ai.topK}</span>
              </div>
            }
          />
          <FieldRow
            label="Repeat penalty"
            desc="Mencegah token berulang (>1.0 = kurangi)."
            stacked
            control={
              <div className="slider-row">
                <Slider
                  min={1}
                  max={2}
                  step={0.1}
                  value={ai.repeatPenalty}
                  onChange={(v) => onChange({ ai: { ...ai, repeatPenalty: Math.round(v * 10) / 10 } })}
                  ariaLabel="Repeat penalty"
                />
                <span className="field-value">{decimalID(ai.repeatPenalty)}</span>
              </div>
            }
          />
          <FieldRow
            label="Stop sequences"
            desc="Pisahkan dengan koma (mis. AI:,Pengguna:)."
            stacked
            control={
              <input
                type="text"
                className="input input--sm"
                value={ai.stopSequences}
                onChange={(e) => onChange({ ai: { ...ai, stopSequences: e.target.value } })}
                placeholder="contoh: AI:,Pengguna:"
                aria-label="Stop sequences"
              />
            }
          />
          <FieldRow
            label="Seed"
            desc="Acak hasil (kosongkan = acak)."
            stacked
            control={
              <input
                type="number"
                className="input input--sm"
                value={ai.seed ?? ""}
                onChange={(e) =>
                  onChange({
                    ai: {
                      ...ai,
                      seed: e.target.value ? parseInt(e.target.value, 10) : null,
                    },
                  })
                }
                placeholder="acak"
                aria-label="Seed"
                min={0}
              />
            }
          />
        </section>

        <section className="settings-section" aria-labelledby="sec-update">
          <h2 className="panel-title" id="sec-update">
            Pembaruan
          </h2>
          <FieldRow
            label="Cek otomatis"
            desc="Periksa rilis terbaru saat aplikasi terbuka."
            control={
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={settings.update?.autoCheck ?? false}
                  onChange={(e) =>
                    onChange({
                      update: { ...(settings.update ?? { autoCheck: true, channel: "stable" }), autoCheck: e.target.checked },
                    })
                  }
                />
                <span className="toggle-track" />
              </label>
            }
          />
          <FieldRow
            label="Channel"
            desc="stable = rilis produksi, beta = versi pra-rilis."
            control={
              <select
                className="select select--sm"
                value={settings.update?.channel ?? "stable"}
                onChange={(e) =>
                  onChange({
                    update: { ...(settings.update ?? { autoCheck: true, channel: "stable" }), channel: e.target.value as "stable" | "beta" },
                  })
                }
              >
                <option value="stable">Stable</option>
                <option value="beta">Beta</option>
              </select>
            }
          />
          <FieldRow
            label="Repo GitHub"
            desc="azaleaforge-ctrl/AzaleaHouse"
            stacked
            control={<code className="path-chip">azaleaforge-ctrl/AzaleaHouse</code>}
          />
        </section>
      </div>
    </div>
  );
}
