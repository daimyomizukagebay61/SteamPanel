import { useState } from "react";
import { useT } from "@/lib/i18n";
import { IconPackage, IconFileText, IconDownload, IconChevronRight } from "@/components/shared/Icons";
import type { MafileExportRequest } from "@/api/types";

const MAFILE_FIELDS = [
  "shared_secret", "serial_number", "revocation_code", "uri",
  "account_name", "token_gid", "identity_secret", "secret_1",
  "device_id", "server_time", "fully_enrolled",
];

const SESSION_FIELDS = [
  "SessionID", "AccessToken", "RefreshToken", "SteamID", "SteamLoginSecure",
];

const NAME_VARS = [
  { value: "{username}", label: "username" },
  { value: "{steamid}", label: "steamid" },
];

const FORMAT_OPTIONS: { value: MafileExportRequest["format"]; icon: string }[] = [
  { value: "flat_mafiles", icon: "📄" },
  { value: "per_account_folder", icon: "📁" },
  { value: "single_file", icon: "📦" },
];

interface Props {
  accountIds: number[];
  onExport: (req: MafileExportRequest) => void;
}

export function ExportSettings({ accountIds, onExport }: Props) {
  const t = useT();
  const [fields, setFields] = useState<Set<string>>(new Set(MAFILE_FIELDS));
  const [sessionFields, setSessionFields] = useState<Set<string>>(new Set(SESSION_FIELDS));
  const [format, setFormat] = useState<MafileExportRequest["format"]>("per_account_folder");

  const [folderNameTemplate, setFolderNameTemplate] = useState("{username}");
  const [mafileNameTemplate, setMafileNameTemplate] = useState("{steamid}.mafile");
  const [txtNameTemplate, setTxtNameTemplate] = useState("{username}.txt");

  const [includeTxtPerFolder, setIncludeTxtPerFolder] = useState(false);
  const [includeGlobalTxt, setIncludeGlobalTxt] = useState(false);
  const [skipFolders, setSkipFolders] = useState(false);
  const [txtFormat, setTxtFormat] = useState("{login}:{password}:{email}:{email_password}");

  const toggleField = (set: Set<string>, key: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setter(next);
  };

  const insertVar = (setter: (fn: (prev: string) => string) => void, varName: string) => {
    setter((prev) => prev + varName);
  };

  const handleExport = () => {
    onExport({
      fields: [...fields],
      session_fields: [...sessionFields],
      format,
      account_ids: accountIds,
      folder_name_template: folderNameTemplate,
      mafile_name_template: mafileNameTemplate,
      txt_name_template: txtNameTemplate,
      include_txt_per_folder: includeTxtPerFolder,
      include_global_txt: includeGlobalTxt,
      skip_folders: skipFolders,
      txt_format: txtFormat,
    });
  };

  return (
    <div className="bg-dark-800 border border-dark-600 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-dark-600 flex items-center gap-2">
        <IconPackage size={14} className="text-accent" />
        <h4 className="font-semibold text-sm">{t("mafile.exportSettings")}</h4>
      </div>

      <div className="p-4 space-y-4">
        {/* Format selector — card-style buttons */}
        <div>
          <p className="text-xs text-gray-400 mb-2">{t("mafile.exportFormat")}</p>
          <div className="grid grid-cols-3 gap-2">
            {FORMAT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => {
                  setFormat(opt.value);
                  if (opt.value === "single_file") {
                    setIncludeGlobalTxt(false);
                    setSkipFolders(false);
                  }
                }}
                className={`flex flex-col items-center gap-1 p-3 rounded-lg border text-xs transition-all cursor-pointer ${
                  format === opt.value
                    ? "border-accent bg-accent/10 text-white"
                    : "border-dark-600 bg-dark-700 text-gray-400 hover:border-dark-500 hover:text-gray-300"
                }`}
              >
                <span className="text-base">{opt.icon}</span>
                <span>{t(`mafile.${opt.value}` as any)}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Naming templates */}
        {format !== "single_file" && (
          <details className="group" open>
            <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-300 transition-colors flex items-center gap-1.5 select-none">
              <IconChevronRight size={12} className="transition-transform group-open:rotate-90" />
              {t("mafile.namingSection")}
              <span className="text-gray-500 ml-1">
                <code className="text-accent/70">{"{username}"}</code> <code className="text-accent/70">{"{steamid}"}</code>
              </span>
            </summary>
            <div className="mt-3 space-y-3 pl-4 border-l border-dark-600">
              {format === "per_account_folder" && (
                <TemplateInput
                  label={t("mafile.folderName")}
                  value={folderNameTemplate}
                  onChange={setFolderNameTemplate}
                  vars={NAME_VARS}
                  insertVar={insertVar}
                />
              )}
              <TemplateInput
                label={t("mafile.mafileName")}
                value={mafileNameTemplate}
                onChange={setMafileNameTemplate}
                vars={NAME_VARS}
                insertVar={insertVar}
              />
            </div>
          </details>
        )}

        {/* .txt options */}
        <details className="group">
          <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-300 transition-colors flex items-center gap-1.5 select-none">
            <IconChevronRight size={12} className="transition-transform group-open:rotate-90" />
            <IconFileText size={12} className="inline" />
            {t("mafile.txtSettings")}
          </summary>
          <div className="mt-3 space-y-2.5 pl-4 border-l border-dark-600">
            {format !== "single_file" && (
              <>
                <ToggleOption checked={includeGlobalTxt} onChange={(v) => { setIncludeGlobalTxt(v); if (!v) setSkipFolders(false); }}>
                  {t("mafile.addGlobalTxt")} <code className="text-accent text-xs">accounts.txt</code>
                </ToggleOption>

                {format === "per_account_folder" && (
                  <ToggleOption checked={includeTxtPerFolder} onChange={setIncludeTxtPerFolder}>
                    {t("mafile.addTxtPerFolder")}
                  </ToggleOption>
                )}

                <ToggleOption checked={skipFolders} onChange={setSkipFolders} disabled={!includeGlobalTxt}>
                  {t("mafile.skipFolders")}
                </ToggleOption>
              </>
            )}

            {(includeGlobalTxt || includeTxtPerFolder || format === "single_file") && (
              <div className="space-y-3 pt-1">
                {format === "per_account_folder" && includeTxtPerFolder && (
                  <TemplateInput
                    label={t("mafile.txtFolderName")}
                    value={txtNameTemplate}
                    onChange={setTxtNameTemplate}
                    vars={NAME_VARS}
                    insertVar={insertVar}
                  />
                )}
                <div>
                  <label className="text-xs text-gray-400 block mb-1">{t("mafile.txtLineFormat")}</label>
                  <input
                    value={txtFormat}
                    onChange={(e) => setTxtFormat(e.target.value)}
                    className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-1.5 text-sm font-mono focus:border-accent/50 focus:outline-none transition-colors"
                  />
                  <p className="text-[11px] text-gray-500 mt-1.5 leading-relaxed">
                    {t("mafile.variables")} <code className="text-accent/70">{"{login}"}</code> <code className="text-accent/70">{"{password}"}</code> <code className="text-accent/70">{"{email}"}</code> <code className="text-accent/70">{"{email_password}"}</code> <code className="text-accent/70">{"{steam_id}"}</code> <code className="text-accent/70">{"{proxy}"}</code> <code className="text-accent/70">{"{mafile}"}</code>
                  </p>
                </div>
              </div>
            )}
          </div>
        </details>

        {/* Field selection */}
        <details className="group">
          <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-300 transition-colors flex items-center gap-1.5 select-none">
            <IconChevronRight size={12} className="transition-transform group-open:rotate-90" />
            {t("mafile.mafileFields")}
            <span className="text-gray-500 text-[11px]">{fields.size}/{MAFILE_FIELDS.length}</span>
          </summary>
          <div className="flex flex-wrap gap-x-3 gap-y-1.5 mt-2 pl-4">
            {MAFILE_FIELDS.map((f) => (
              <label key={f} className="flex items-center gap-1.5 text-xs cursor-pointer hover:text-gray-200 transition-colors">
                <input type="checkbox" checked={fields.has(f)} onChange={() => toggleField(fields, f, setFields)} className="accent-accent" />
                <span className="font-mono text-[11px]">{f}</span>
              </label>
            ))}
          </div>
        </details>

        <details className="group">
          <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-300 transition-colors flex items-center gap-1.5 select-none">
            <IconChevronRight size={12} className="transition-transform group-open:rotate-90" />
            {t("mafile.sessionFields")}
            <span className="text-gray-500 text-[11px]">{sessionFields.size}/{SESSION_FIELDS.length}</span>
          </summary>
          <div className="flex flex-wrap gap-x-3 gap-y-1.5 mt-2 pl-4">
            {SESSION_FIELDS.map((f) => (
              <label key={f} className="flex items-center gap-1.5 text-xs cursor-pointer hover:text-gray-200 transition-colors">
                <input type="checkbox" checked={sessionFields.has(f)} onChange={() => toggleField(sessionFields, f, setSessionFields)} className="accent-accent" />
                <span className="font-mono text-[11px]">{f}</span>
              </label>
            ))}
          </div>
        </details>

        {/* Export button */}
        <button
          onClick={handleExport}
          disabled={accountIds.length === 0}
          className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg font-medium text-sm transition-all ${
            accountIds.length === 0
              ? "bg-dark-700 text-gray-500 cursor-not-allowed"
              : "bg-accent hover:bg-accent-hover text-white cursor-pointer"
          }`}
        >
          <IconDownload size={14} />
          {t("mafile.export")} ({accountIds.length > 0 ? accountIds.length : t("mafile.noAccounts")})
        </button>
      </div>
    </div>
  );
}

function TemplateInput({ label, value, onChange, vars, insertVar }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  vars: { value: string; label: string }[];
  insertVar: (setter: (fn: (prev: string) => string) => void, varName: string) => void;
}) {
  return (
    <div>
      <label className="text-xs text-gray-400 block mb-1">{label}</label>
      <div className="flex gap-1.5">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 bg-dark-700 border border-dark-600 rounded-lg px-3 py-1.5 text-sm font-mono focus:border-accent/50 focus:outline-none transition-colors"
        />
        {vars.map((v) => (
          <button
            key={v.value}
            onClick={() => insertVar((fn) => onChange(fn(value)), v.value)}
            className="px-2 py-1 text-[11px] rounded bg-dark-700 border border-dark-600 text-gray-400 hover:text-accent hover:border-accent/30 transition-colors cursor-pointer"
          >
            {v.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ToggleOption({ checked, onChange, disabled, children }: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={`flex items-center gap-2.5 text-sm cursor-pointer select-none ${disabled ? "opacity-40 cursor-not-allowed" : "hover:text-gray-200"} transition-colors`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-accent"
      />
      <span className="text-xs">{children}</span>
    </label>
  );
}
