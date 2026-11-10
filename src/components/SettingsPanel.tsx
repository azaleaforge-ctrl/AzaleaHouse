import type { AiProvider, AiSettings } from "../types";
import type { SkillId } from "../data/skills";
import type { ModelMeta, RouterModel } from "../lib/tauri";
import { contextOptions, outputOptions } from "../data/mock";
import { decimalID } from "../lib/format";
import { SKILLS } from "../data/skills";
import { PLUGINS, pluginAvailability } from "../data/plugins";
import { FieldRow, Slider, Switch } from "./Controls";
import { IconInfo } from "./Icons";

export function SettingsPanel({
  settings,
  localModels,
  routerModels,
  routerConnected,
  visionModel,
  activeSkillIds,
  onChange,
  onProviderChange,
  onOpenConnect,
  onDisconnect,
  onRefreshModels,
  routerBusy,
  onOpenAdvanced,
}: {
  settings: AiSettings;
  localModels: ModelMeta[];
  routerModels: RouterModel[];
  routerConnected: boolean;
  visionModel: string;
  activeSkillIds: SkillId[];
  onChange: (patch: Partial<AiSettings>) => void;
  onProviderChange: (provider: AiProvider) => void;
  onOpenConnect: () => void;
  onDisconnect: () => void;
  onRefreshModels: () => void;
  routerBusy: boolean;
  onOpenAdvanced: () => void;
}) {
  const localModel = localModels.find((item) => item.id === settings.model);
  const routerModel = routerModels.find((item) => item.id === settings.model);
  const thinkingSupported = settings.provider === "9router" ? routerConnected : Boolean(localModel?.thinking_supported);
  const selectedRouterContext = routerModel?.context_length;
  const orderedPlugins = PLUGINS.map((plugin) => ({ ...plugin, ...pluginAvailability(plugin.id, routerConnected, visionModel) }))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
  const orderedSkills = [...SKILLS].sort((a, b) => {
    const activeDifference = Number(activeSkillIds.includes(b.id)) - Number(activeSkillIds.includes(a.id));
    return activeDifference || a.name.localeCompare(b.name);
  });

  return (
    <aside className="panel" aria-label="Panel pengaturan AI">
      <div className="panel-head">
        <h2 className="panel-title">Pengaturan AI</h2>
        <span className="tag">Provider</span>
      </div>

      <section className="panel-section">
        <FieldRow
          label="Provider"
          desc="Pilih sumber model untuk percakapan."
          stacked
          control={
            <select
              className="select select--full"
              value={settings.provider}
              onChange={(event) => onProviderChange(event.target.value as AiProvider)}
              aria-label="Provider AI"
            >
              <option value="local">AI Local · Ollama</option>
              <option value="9router" disabled={!routerConnected}>9Router {!routerConnected ? "· connect dulu" : ""}</option>
            </select>
          }
        />
        <div className="panel-provider-actions">
          <span className={"panel-provider-state" + (routerConnected ? " is-connected" : "")}>
            <span className="status-dot" style={{ background: routerConnected ? "var(--color-mint-400)" : "rgba(255,255,255,.25)", marginRight: 6 }} />
            {routerConnected ? "9Router terhubung" : "9Router belum terhubung"}
          </span>
          {routerConnected ? (
            <>
              <button type="button" className="btn" disabled={routerBusy} onClick={onRefreshModels}>{routerBusy ? "Memuat…" : "Refresh models"}</button>
              <button type="button" className="btn" onClick={onDisconnect}>Disconnect</button>
            </>
          ) : (
            <button type="button" className="btn btn--primary" onClick={onOpenConnect}>/connect</button>
          )}
        </div>
      </section>

      <section className="panel-section">
        <FieldRow
          label="Thinking"
          desc={
            !thinkingSupported
              ? "Model lokal ini tidak terdeteksi mendukung Thinking."
              : settings.provider === "9router"
                ? "Mode instruksi penalaran untuk model provider; kemampuan reasoning bawaan tetap bergantung pada model."
                : "Aktifkan penalaran bila model lokal mendukungnya."
          }
          control={
            <Switch
              checked={thinkingSupported && settings.thinking}
              onChange={(value) => onChange({ thinking: value })}
              disabled={!thinkingSupported}
              ariaLabel="Thinking"
            />
          }
        />
      </section>

      <section className="panel-section">
        <FieldRow
          label={settings.provider === "9router" ? "Usage context" : "Context window"}
          desc={settings.provider === "9router"
            ? "Batas konteks yang disediakan model 9Router."
            : "Jumlah token konteks yang dikirim ke Ollama."}
          stacked
          control={settings.provider === "9router" ? (
            <div className="path-chip">
              {selectedRouterContext
                ? selectedRouterContext.toLocaleString("id-ID") + " token · dari metadata model"
                : "Batas konteks ditentukan oleh model/provider"}
            </div>
          ) : (
            <select
              className="select select--full"
              value={settings.contextWindow}
              onChange={(event) => onChange({ contextWindow: Number(event.target.value) })}
              aria-label="Context window"
            >
              {contextOptions.map((context) => (
                <option key={context} value={context}>
                  {context.toLocaleString("id-ID")} token
                </option>
              ))}
            </select>
          )}
        />
        <FieldRow
          label="Batas output"
          desc="Batas token keluaran per respons. Provider dapat menerapkan batas yang lebih rendah."
          stacked
          control={
            <select
              className="select select--full"
              value={settings.maxOutputTokens}
              onChange={(event) => onChange({ maxOutputTokens: Number(event.target.value) })}
              aria-label="Batas output"
            >
              {outputOptions.map((option) => (
                <option key={option} value={option}>
                  {option.toLocaleString("id-ID")} token
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
                value={settings.temperature}
                onChange={(value) => onChange({ temperature: Math.round(value * 10) / 10 })}
                ariaLabel="Temperature"
              />
              <span className="field-value">{decimalID(settings.temperature)}</span>
            </div>
          }
        />
      </section>

      <section className="panel-section">
        <FieldRow
          label="Vision helper"
          desc={settings.provider === "9router"
            ? "Model multimodal tambahan untuk membaca gambar lalu mengirim ringkasannya ke model utama yang hanya mendukung teks. Pilih model 9Router yang memang menerima gambar."
            : "Model lokal yang mendukung vision dapat dipilih sebagai model utama melalui AI Local."}
          stacked
          control={settings.provider === "9router" ? (
            <select
              className="select select--full"
              value={settings.visionModel}
              onChange={(event) => onChange({ visionModel: event.target.value })}
              aria-label="Vision helper model"
              disabled={!routerConnected}
            >
              <option value="">Tidak menggunakan helper</option>
              {routerModels.map((model) => <option key={model.id} value={model.id}>{model.name || model.id}</option>)}
            </select>
          ) : (
            <div className="path-chip">Vision langsung mengikuti kemampuan model Ollama yang dipilih.</div>
          )}
        />
      </section>

      <section className="panel-section">
        <FieldRow
          label="Model"
          desc={settings.provider === "9router"
            ? "Model yang muncul berasal dari endpoint /v1/models setelah API key tervalidasi."
            : "Model yang telah terpasang di Ollama lokal."}
          stacked
          control={
            <select
              className="select select--full"
              value={settings.model}
              onChange={(event) => onChange({ model: event.target.value })}
              aria-label="Model AI"
              disabled={settings.provider === "9router" ? !routerConnected || routerModels.length === 0 : localModels.length === 0}
            >
              {(settings.provider === "9router" ? routerModels : localModels).length === 0
                ? <option value="">{settings.provider === "9router" ? "Belum ada model 9Router" : "Belum ada model lokal"}</option>
                : null}
              {settings.provider === "9router"
                ? routerModels.map((model) => <option key={model.id} value={model.id}>{model.name || model.id}</option>)
                : localModels.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
            </select>
          }
        />
      </section>

      <section className="panel-section">
        <div className="panel-head">
          <h3 className="panel-title">Skills</h3>
          <span className="tag">{activeSkillIds.length} aktif</span>
        </div>
        <div className="skill-list">
          {orderedSkills.map((skill) => {
            const active = activeSkillIds.includes(skill.id as SkillId);
            return (
              <div className={"skill-row" + (active ? " is-active" : "")} key={skill.id} title={skill.description}>
                <span className="skill-state" />
                <span className="skill-name">{skill.name}</span>
                <span className="skill-status">{active ? "Aktif" : "Standby"}</span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="panel-section">
        <div className="panel-head">
          <h3 className="panel-title">Plugins / Tools</h3>
          <span className="tag">{orderedPlugins.filter((plugin) => plugin.active).length} tersedia</span>
        </div>
        <div className="skill-list">
          {orderedPlugins.map((plugin) => (
            <div className={"skill-row" + (plugin.active ? " is-active" : "")} key={plugin.id} title={plugin.description}>
              <span className="skill-state" />
              <span className="skill-name">{plugin.name}</span>
              <span className="skill-status">{plugin.active ? "Aktif" : "Standby"}</span>
            </div>
          ))}
        </div>
      </section>

      <button type="button" className="link-btn" onClick={onOpenAdvanced}>
        Pengaturan lanjutan
      </button>

      <p className="panel-note">
        <IconInfo size={14} />
        Skill aktif dipilih otomatis sesuai permintaan. API key 9Router hanya disimpan selama aplikasi berjalan.
      </p>
    </aside>
  );
}
