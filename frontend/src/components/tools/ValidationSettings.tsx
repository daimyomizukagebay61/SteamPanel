import { useState, useEffect, useRef } from "react";
import type { ValidationSettings as VS, ServicesSettings as SS } from "@/api/types";
import { api } from "@/api/client";
import { useUiStore } from "@/stores/uiStore";
import { useT } from "@/lib/i18n";
import { IconSettings } from "@/components/shared/Icons";

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="toggle-switch">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="toggle-track" />
    </label>
  );
}

function SettingRow({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string;
  desc?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <p className="text-sm text-gray-200 leading-tight">{label}</p>
        {desc && <p className="text-xs text-gray-500 mt-0.5">{desc}</p>}
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}

function NumericStepper({
  label,
  value,
  onChange,
  min = 1,
  steps = [-10, -1, 1, 10],
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  steps?: number[];
}) {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const clamp = (n: number) => Math.max(min, n);
  const commit = () => {
    onChange(clamp(parseInt(input) || value));
    setEditing(false);
  };

  const btnCls =
    "h-6 px-1.5 rounded bg-dark-700 border border-dark-600 text-gray-300 hover:bg-dark-600 text-xs flex items-center justify-center select-none leading-none";

  return (
    <div className="flex items-center gap-3 pt-3 mt-0.5">
      <span
        className="text-sm text-gray-400 flex-1"
        title="Двойной клик на числе для ручного ввода"
      >
        {label}
      </span>
      <div className="flex items-center gap-1">
        {steps.filter((s) => s < 0).map((s) => (
          <button key={s} type="button" className={btnCls} onClick={() => onChange(clamp(value + s))}>
            {s}
          </button>
        ))}
        {editing ? (
          <input
            ref={inputRef}
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setEditing(false);
            }}
            className="w-10 text-center text-sm font-mono bg-dark-900 border border-accent rounded outline-none text-gray-100 py-0.5"
          />
        ) : (
          <span
            className="w-10 text-center text-sm font-mono text-gray-100 cursor-pointer select-none"
            onDoubleClick={() => {
              setInput(String(value));
              setEditing(true);
            }}
            title="Двойной клик для ручного ввода"
          >
            {value}
          </span>
        )}
        {steps.filter((s) => s > 0).map((s) => (
          <button key={s} type="button" className={btnCls} onClick={() => onChange(clamp(value + s))}>
            +{s}
          </button>
        ))}
      </div>
    </div>
  );
}

function ThreadStepper({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const t = useT();
  return (
    <NumericStepper
      label={t("tools.maxThreads")}
      value={value}
      onChange={onChange}
    />
  );
}

export function ValidationSettings() {
  const t = useT();
  const [settings, setSettings] = useState<VS>({
    fetch_profile: true,
    check_ban: true,
    max_threads: 5,
    auto_revalidate_browser: true,
    auto_proxy_on_import: false,
    auto_validate_on_import: false,
    auto_proxy_on_import_mafile: true,
    auto_proxy_on_import_logpass: true,
    auto_proxy_on_import_token: true,
    auto_validate_on_import_mafile: true,
    auto_validate_on_import_logpass: true,
    auto_validate_on_import_token: true,
  });
  const [services, setServices] = useState<SS>({
    auto_accept_interval: 15,
    auto_confirm_interval: 30,
  });
  const [importTab, setImportTab] = useState<"mafile" | "logpass" | "token">(
    "mafile",
  );
  const hidePasswords = useUiStore((s) => s.hidePasswords);
  const setHidePasswords = useUiStore((s) => s.setHidePasswords);
  const loadImportSettings = useUiStore((s) => s.loadImportSettings);
  const addToast = useUiStore((s) => s.addToast);

  useEffect(() => {
    api.getValidationSettings().then(setSettings).catch(() => {});
    api.getServicesSettings().then(setServices).catch(() => {});
  }, []);

  const save = async () => {
    try {
      await Promise.all([
        api.updateValidationSettings(settings),
        api.updateServicesSettings(services),
      ]);
      await loadImportSettings();
      addToast("success", t("toast.settingsSaved"));
    } catch (e: unknown) {
      addToast(
        "error",
        t("misc.error", { error: e instanceof Error ? e.message : String(e) }),
      );
    }
  };

  return (
    <div className="bg-dark-800 border border-dark-600 rounded-xl overflow-hidden flex flex-col">
      <div className="px-5 py-3.5 border-b border-dark-600 flex items-center gap-2.5">
        <IconSettings size={15} className="text-accent shrink-0" />
        <span className="text-sm font-semibold text-gray-100">Settings</span>
      </div>

      <div className="px-5 pt-4 pb-3 border-b border-dark-600">
        <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-0.5">
          {t("tools.validationSettings")}
        </p>
        <div className="divide-y divide-dark-600/60">
          <SettingRow
            label={t("tools.loadProfile")}
            checked={settings.fetch_profile}
            onChange={(v) => setSettings({ ...settings, fetch_profile: v })}
          />
          <SettingRow
            label={t("tools.checkBans")}
            checked={settings.check_ban}
            onChange={(v) => setSettings({ ...settings, check_ban: v })}
          />
          <SettingRow
            label={t("tools.autoRevalidateBrowser")}
            checked={settings.auto_revalidate_browser}
            onChange={(v) =>
              setSettings({ ...settings, auto_revalidate_browser: v })
            }
          />
        </div>
        <ThreadStepper
          value={settings.max_threads}
          onChange={(v) => setSettings((s) => ({ ...s, max_threads: v }))}
        />
      </div>

      <div className="px-5 pt-4 pb-3 border-b border-dark-600">
        <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-1.5">
          {t("tools.importSettings")}
        </p>
        {/* Tab switcher */}
        <div className="flex gap-1 mb-3">
          {(["mafile", "logpass", "token"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setImportTab(tab)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                importTab === tab
                  ? "bg-accent/20 text-accent border border-accent/30"
                  : "text-gray-500 hover:text-gray-300 border border-transparent"
              }`}
            >
              {t(
                `tools.importTab${tab.charAt(0).toUpperCase() + tab.slice(1)}` as never,
              )}
            </button>
          ))}
        </div>
        {/* Per-tab toggles */}
        {(["mafile", "logpass", "token"] as const).map((tab) =>
          importTab === tab ? (
            <div key={tab} className="divide-y divide-dark-600/60">
              <SettingRow
                label={t("tools.autoProxyOnImport")}
                desc={t("tools.autoProxyOnImportDesc")}
                checked={
                  settings[`auto_proxy_on_import_${tab}` as keyof VS] as boolean
                }
                onChange={(v) =>
                  setSettings({
                    ...settings,
                    [`auto_proxy_on_import_${tab}`]: v,
                  })
                }
              />
              <SettingRow
                label={t("tools.autoValidateOnImport")}
                desc={t("tools.autoValidateOnImportDesc")}
                checked={
                  settings[
                    `auto_validate_on_import_${tab}` as keyof VS
                  ] as boolean
                }
                onChange={(v) =>
                  setSettings({
                    ...settings,
                    [`auto_validate_on_import_${tab}`]: v,
                  })
                }
              />
            </div>
          ) : null,
        )}
      </div>

      <div className="px-5 pt-4 pb-3 border-b border-dark-600">
        <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-0.5">
          {t("settings.display")}
        </p>
        <SettingRow
          label={t("settings.hidePasswords")}
          checked={hidePasswords}
          onChange={setHidePasswords}
        />
      </div>

      <div className="px-5 pt-4 pb-3">
        <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-0.5">
          {t("tools.servicesSettings")}
        </p>
        <NumericStepper
          label={t("tools.autoAcceptInterval")}
          value={services.auto_accept_interval}
          onChange={(v) => setServices((s) => ({ ...s, auto_accept_interval: v }))}
          min={5}
          steps={[-15, -10, -5, 5, 10, 15]}
        />
        <NumericStepper
          label={t("tools.autoConfirmInterval")}
          value={services.auto_confirm_interval}
          onChange={(v) => setServices((s) => ({ ...s, auto_confirm_interval: v }))}
          min={5}
          steps={[-15, -10, -5, 5, 10, 15]}
        />
      </div>

      <div className="px-5 py-3 border-t border-dark-600 flex justify-end">
        <button onClick={save} className="btn-primary">
          {t("btn.save")}
        </button>
      </div>
    </div>
  );
}
