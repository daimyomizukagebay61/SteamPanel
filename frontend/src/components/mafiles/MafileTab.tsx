import { api } from "@/api/client";
import { useAccountStore } from "@/stores/accountStore";
import { useUiStore } from "@/stores/uiStore";
import type { MafileExportRequest } from "@/api/types";
import { ExportSettings } from "./ExportSettings";
import { useT } from "@/lib/i18n";

import { IconClipboard } from "@/components/shared/Icons";

export function MafileTab() {
  const t = useT();
  const accounts = useAccountStore((s) => s.accounts);
  const mafileManagerIds = useAccountStore((s) => s.mafileManagerIds);
  const clearMafileManager = useAccountStore((s) => s.clearMafileManager);
  const addToast = useUiStore((s) => s.addToast);
  // Bug #3: only show explicitly sent accounts
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

  return (
    <div className="space-y-4 h-full overflow-y-auto pr-1">
      {/* Sent accounts list — Bug #3: only sent accounts shown */}
      {sentAccounts.length > 0 && (
        <div className="bg-dark-800 border border-dark-600 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">
              <IconClipboard size={14} className="inline mr-1" />{t("mafile.sentAccounts")} ({sentAccounts.length})
            </h3>
            <button onClick={clearMafileManager} className="btn-danger-outline text-xs">{t("mafile.clearBtn")}</button>
          </div>
          <div className="max-h-48 overflow-y-auto space-y-1">
            {sentAccounts.map((a) => (
              <div key={a.id} className="flex items-center gap-2 text-xs text-gray-300 min-w-0">
                {a.avatar_url && <img src={a.avatar_url} className="avatar-sm shrink-0" alt="" />}
                <span className="truncate">{a.login}</span>
                <span className="text-gray-500 truncate">{a.steam_id || ""}</span>
                <span className={a.mafile_path ? "text-green-400" : "text-gray-500"}>
                  {a.mafile_path ? "✓ mafile" : "—"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Export settings — Bug #6: flexible export */}
      <ExportSettings
        accountIds={[...mafileManagerIds]}
        onExport={handleExport}
      />
    </div>
  );
}
