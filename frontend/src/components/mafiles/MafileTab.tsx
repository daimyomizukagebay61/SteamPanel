import { api } from "@/api/client";
import { useAccountStore } from "@/stores/accountStore";
import { useUiStore } from "@/stores/uiStore";
import type { MafileExportRequest } from "@/api/types";
import { ExportSettings } from "./ExportSettings";
import { useT } from "@/lib/i18n";

import { IconClipboard, IconPackage } from "@/components/shared/Icons";

export function MafileTab() {
  const t = useT();
  const accounts = useAccountStore((s) => s.accounts);
  const mafileManagerIds = useAccountStore((s) => s.mafileManagerIds);
  const clearMafileManager = useAccountStore((s) => s.clearMafileManager);
  const addToast = useUiStore((s) => s.addToast);
  const sentAccounts = accounts.filter((a) => mafileManagerIds.has(a.id));

  const handleExport = async (req: MafileExportRequest) => {
    try {
      const blob = await api.exportZip(req);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "mafiles_export.zip";
      a.click();
      URL.revokeObjectURL(url);
      addToast("success", t("toast.exportDone"));
    } catch (e: unknown) {
      addToast("error", t("misc.exportError", { error: e instanceof Error ? e.message : String(e) }));
    }
  };

  const withMafile = sentAccounts.filter((a) => a.mafile_path).length;

  return (
    <div className="h-full overflow-y-auto pr-1">
      <div className="max-w-2xl mx-auto space-y-5 py-2">

        {/* Empty state */}
        {sentAccounts.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-14 h-14 rounded-2xl bg-dark-700 flex items-center justify-center mb-4">
              <IconPackage size={24} className="text-gray-500" />
            </div>
            <p className="text-gray-400 text-sm mb-1">{t("mafile.emptyTitle")}</p>
            <p className="text-gray-500 text-xs max-w-xs">{t("mafile.emptyHint")}</p>
          </div>
        )}

        {/* Account list */}
        {sentAccounts.length > 0 && (
          <div className="bg-dark-800 border border-dark-600 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-dark-600">
              <div className="flex items-center gap-2">
                <IconClipboard size={14} className="text-accent" />
                <h3 className="font-semibold text-sm">{t("mafile.sentAccounts")}</h3>
                <span className="text-xs text-gray-500">
                  {sentAccounts.length} {t("mafile.accountsCount")} · {withMafile} {t("mafile.withMafile")}
                </span>
              </div>
              <button onClick={clearMafileManager} className="text-xs text-red-400 hover:text-red-300 transition-colors cursor-pointer">
                {t("mafile.clearBtn")}
              </button>
            </div>
            <div className="max-h-56 overflow-y-auto divide-y divide-dark-700">
              {sentAccounts.map((a) => (
                <div key={a.id} className="flex items-center gap-3 px-4 py-2 hover:bg-dark-700/50 transition-colors">
                  {a.avatar_url ? (
                    <img src={a.avatar_url} className="avatar-sm shrink-0" alt="" />
                  ) : (
                    <div className="w-6 h-6 rounded bg-dark-600 shrink-0" />
                  )}
                  <span className="text-sm truncate flex-1 min-w-0">{a.login}</span>
                  {a.steam_id && <span className="text-xs text-gray-500 font-mono hidden sm:block">{a.steam_id}</span>}
                  <span className={`text-xs px-1.5 py-0.5 rounded ${a.mafile_path ? "bg-green-500/10 text-green-400" : "bg-dark-600 text-gray-500"}`}>
                    {a.mafile_path ? "mafile" : "—"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Export settings */}
        {sentAccounts.length > 0 && (
          <ExportSettings
            accountIds={[...mafileManagerIds]}
            onExport={handleExport}
          />
        )}
      </div>
    </div>
  );
}
