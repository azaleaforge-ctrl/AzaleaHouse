import type { AiSettings } from "../types";
import { contextOptions, models, outputOptions } from "../data/mock";
import { decimalID } from "../lib/format";
import { FieldRow, Segmented, Slider, Switch } from "./Controls";
import { IconInfo } from "./Icons";

export function SettingsPanel({
  settings,
  onChange,
  onOpenAdvanced,
}: {
  settings: AiSettings;
  onChange: (patch: Partial<AiSettings>) => void;
  onOpenAdvanced: () => void;
}) {
  const model = models.find((m) => m.id === settings.model) ?? models[0];
  const thinkingSupported = model?.thinkingSupported ?? true;

  return (
    <aside className="panel" aria-label="Panel pengaturan AI">
      <div className="panel-head">
        <h2 className="panel-title">Pengaturan AI</h2>
        <span className="tag">Pratinjau</span>
      </div>

      <section className="panel-section">
        <FieldRow
          label="Thinking"
          desc={
            thinkingSupported
              ? "Penalaran internal sebelum menjawab."
              : `Model ini tidak mendukung Thinking.`
          }
          control={
            <Switch
              checked={thinkingSupported && settings.thinking}
              onChange={(v) => onChange({ thinking: v })}
              disabled={!thinkingSupported}
              ariaLabel="Thinking"
            />
          }
        />
        <FieldRow
          label="Model"
          control={
            <select
              className="select select--full"
              value={settings.model}
              onChange={(e) => onChange({ model: e.target.value as typeof settings.model })}
              aria-label="Model"
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          }
        />
        <FieldRow
          label="Kebijakan runtime"
          control={
            <Segmented
              ariaLabel="Kebijakan runtime"
              value={settings.runtimePolicy}
              onChange={(v) => onChange({ runtimePolicy: v })}
              options={[
                { value: "auto", label: "Otomatis — 1 jam" },
                { value: "manual", label: "Manual" },
              ]}
            />
          }
        />
      </section>

      <section className="panel-section">
        <FieldRow
          label="Context window"
          stacked
          control={
            <select
              className="select select--full"
              value={settings.contextWindow}
              onChange={(e) => onChange({ contextWindow: Number(e.target.value) })}
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
          desc="Batas per bagian respons. AzaleaHouse akan mencoba melanjutkan otomatis jika Ollama berhenti karena batas token."
          stacked
          control={
            <select
              className="select select--full"
              value={settings.maxOutputTokens}
              onChange={(e) => onChange({ maxOutputTokens: Number(e.target.value) })}
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
                value={settings.temperature}
                onChange={(v) => onChange({ temperature: Math.round(v * 10) / 10 })}
                ariaLabel="Temperature"
              />
              <span className="field-value">{decimalID(settings.temperature)}</span>
            </div>
          }
        />
      </section>

      <button type="button" className="link-btn" onClick={onOpenAdvanced}>
        Pengaturan lanjutan
      </button>

      <p className="panel-note">
        <IconInfo size={14} />
        Nilai langsung diterapkan ke runtime pada permintaan berikutnya.
      </p>
    </aside>
  );
}
