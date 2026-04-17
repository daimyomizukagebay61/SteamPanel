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

interface Props {
  accountIds: number[];
  onExport: (req: MafileExportRequest) => void;
}

export function ExportSettings({ accountIds, onExport }: Props) {
  const t = useT();
  const [fields, setFields] = useState<Set<string>>(new Set(MAFILE_FIELDS));
  const [sessionFields, setSessionFields] = useState<Set<string>>(new Set(SESSION_FIELDS));
  const [format, setFormat] = useState<MafileExportRequest["format"]>("per_account_folder");

  // Naming templates
  const [folderNameTemplate, setFolderNameTemplate] = useState("{username}");
  const [mafileNameTemplate, setMafileNameTemplate] = useState("{steamid}.mafile");
  const [txtNameTemplate, setTxtNameTemplate] = useState("{username}.txt");

  // .txt options
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
    <div className="bg-dark-800 border border-dark-600 rounded-lg p-4 space-y-4">
      <h4 className="font-semibold text-sm"><IconPackage size={14} className="inline mr-1" />{t("mafile.exportSettings")}</h4>

      {/* Format */}
      <div>
        <p className="text-xs text-gray-400 mb-1">{t("mafile.exportFormat")}</p>
        <select
          value={format}
          onChange={(e) => {
            const val = e.target.value as MafileExportRequest["format"];
            setFormat(val);
            if (val === "single_file") {
              setIncludeGlobalTxt(false);
              setSkipFolders(false);
            }
          }}
          className="bg-dark-700 border border-dark-600 rounded px-2 py-1 text-sm"
        >
          <option value="flat_mafiles">{t("mafile.flatFiles")}</option>
          <option value="per_account_folder">{t("mafile.perAccountFolder")}</option>
          <option value="single_file">{t("mafile.singleFile")}</option>
        </select>
      </div>

      {/* Naming templates */}
      {format !== "single_file" && (
        <div className="space-y-3 border border-dark-600 rounded-lg p-3">
          <p className="text-xs text-gray-400 font-medium">
            {t("mafile.variables")} <code className="text-accent">{"{username}"}</code>, <code className="text-accent">{"{steamid}"}</code>
          </p>

          {format === "per_account_folder" && (
            <div>
              <label className="text-xs text-gray-400 block mb-1">{t("mafile.folderName")}</label>
              <div className="flex gap-1">
                <input
                  value={folderNameTemplate}
                  onChange={(e) => setFolderNameTemplate(e.target.value)}
                  className="flex-1 bg-dark-700 border border-dark-600 rounded px-2 py-1 text-sm font-mono"
                />
                {NAME_VARS.map((v) => (
                  <button
                    key={v.value}
                    onClick={() => insertVar(setFolderNameTemplate, v.value)}
                    className="btn-secondary px-2 py-1 text-xs"
                    title={t("mafile.insert", { value: v.value })}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="text-xs text-gray-400 block mb-1">{t("mafile.mafileName")}</label>
            <div className="flex gap-1">
              <input
                value={mafileNameTemplate}
                onChange={(e) => setMafileNameTemplate(e.target.value)}
                className="flex-1 bg-dark-700 border border-dark-600 rounded px-2 py-1 text-sm font-mono"
              />
              {NAME_VARS.map((v) => (
                <button
                  key={v.value}
                  onClick={() => insertVar(setMafileNameTemplate, v.value)}
                  className="btn-secondary px-2 py-1 text-xs"
                  title={t("mafile.insert", { value: v.value })}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* .txt options */}
      <div className="space-y-2 border border-dark-600 rounded-lg p-3">
        <p className="text-xs text-gray-400 font-medium"><IconFileText size={12} className="inline mr-1" />{t("mafile.txtSettings")}</p>

        {format !== "single_file" && (
          <>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={includeGlobalTxt}
                onChange={(e) => {
                  setIncludeGlobalTxt(e.target.checked);
                  if (!e.target.checked) setSkipFolders(false);
                }}
              />
              {t("mafile.addGlobalTxt")} <code className="text-accent text-xs">accounts.txt</code> {t("mafile.withAllAccounts")}
            </label>

            {format === "per_account_folder" && (
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeTxtPerFolder}
                  onChange={(e) => setIncludeTxtPerFolder(e.target.checked)}
                />
                {t("mafile.addTxtPerFolder")}
              </label>
            )}

            <label className={`flex items-center gap-2 text-sm ${includeGlobalTxt ? "cursor-pointer" : "cursor-not-allowed opacity-40"}`}>
              <input
                type="checkbox"
                checked={skipFolders}
                disabled={!includeGlobalTxt}
                onChange={(e) => setSkipFolders(e.target.checked)}
              />
              {t("mafile.skipFolders")}
            </label>
          </>
        )}

        {(includeGlobalTxt || includeTxtPerFolder || format === "single_file") && (
          <>
            {format === "per_account_folder" && includeTxtPerFolder && (
              <div>
                <label className="text-xs text-gray-400 block mb-1">{t("mafile.txtFolderName")}</label>
                <div className="flex gap-1">
                  <input
                    value={txtNameTemplate}
                    onChange={(e) => setTxtNameTemplate(e.target.value)}
                    className="flex-1 bg-dark-700 border border-dark-600 rounded px-2 py-1 text-sm font-mono"
                  />
                  {NAME_VARS.map((v) => (
                    <button
                      key={v.value}
                      onClick={() => insertVar(setTxtNameTemplate, v.value)}
                      className="btn-secondary px-2 py-1 text-xs"
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <label className="text-xs text-gray-400 block mb-1">
                {t("mafile.txtLineFormat")}
              </label>
              <input
                value={txtFormat}
                onChange={(e) => setTxtFormat(e.target.value)}
                className="w-full bg-dark-700 border border-dark-600 rounded px-2 py-1 text-sm font-mono"
              />
              <p className="text-xs text-gray-500 mt-1">
                {t("mafile.variables")} <code className="text-accent">{"{login}"}</code> <code className="text-accent">{"{password}"}</code> <code className="text-accent">{"{email}"}</code> <code className="text-accent">{"{email_password}"}</code> <code className="text-accent">{"{steam_id}"}</code> <code className="text-accent">{"{proxy}"}</code> <code className="text-accent">{"{mafile}"}</code>
              </p>
            </div>
          </>
        )}
      </div>

      {/* Field selection */}
      <details className="group">
        <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-300 transition-colors flex items-center gap-1">
          <IconChevronRight size={12} className="transition-transform group-open:rotate-90" />
          {t("mafile.mafileFields")} ({fields.size}/{MAFILE_FIELDS.length})
        </summary>
        <div className="flex flex-wrap gap-2 mt-2">
          {MAFILE_FIELDS.map((f) => (
            <label key={f} className="flex items-center gap-1 text-xs cursor-pointer">
              <input type="checkbox" checked={fields.has(f)} onChange={() => toggleField(fields, f, setFields)} />
              {f}
            </label>
          ))}
        </div>
      </details>

      <details className="group">
        <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-300 transition-colors flex items-center gap-1">
          <IconChevronRight size={12} className="transition-transform group-open:rotate-90" />
          {t("mafile.sessionFields")} ({sessionFields.size}/{SESSION_FIELDS.length})
        </summary>
        <div className="flex flex-wrap gap-2 mt-2">
          {SESSION_FIELDS.map((f) => (
            <label key={f} className="flex items-center gap-1 text-xs cursor-pointer">
              <input type="checkbox" checked={sessionFields.has(f)} onChange={() => toggleField(sessionFields, f, setSessionFields)} />
              {f}
            </label>
          ))}
        </div>
      </details>

      <button
        onClick={handleExport}
        disabled={accountIds.length === 0}
        className={accountIds.length === 0 ? "btn-primary opacity-50 cursor-not-allowed" : "btn-primary"}
      >
        <IconDownload size={14} className="inline mr-1" />{t("mafile.export")} ({accountIds.length > 0 ? accountIds.length : t("mafile.noAccounts")})
      </button>
    </div>
  );
}
