import { useState, useEffect, useCallback } from "react";
import { api } from "@/api/client";
import type { Account, SteamConfirmation } from "@/api/types";
import { useUiStore } from "@/stores/uiStore";
import { useT } from "@/lib/i18n";
import { IconRefresh, IconCheck, IconX } from "@/components/shared/Icons";

const TYPE_ICONS: Record<number, string> = {
  0: "❓",
  1: "🧪",
  2: "🔄",
  3: "🏪",
  4: "⚙️",
  5: "📱",
  6: "🔑",
};

interface Props {
  account: Account;
  onClose: () => void;
}

export function ConfirmationsModal({ account, onClose }: Props) {
  const t = useT();
  const addToast = useUiStore((s) => s.addToast);
  const [confirmations, setConfirmations] = useState<SteamConfirmation[]>([]);
  const [loading, setLoading] = useState(true);
  const [responding, setResponding] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const fetchConfs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getConfirmations(account.id);
      setConfirmations(data.confirmations);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [account.id]);

  useEffect(() => {
    fetchConfs();
  }, [fetchConfs]);

  const handleRespond = async (ids: string[], nonces: string[], accept: boolean) => {
    const newSet = new Set(responding);
    ids.forEach((id) => newSet.add(id));
    setResponding(newSet);

    try {
      const { success } = await api.respondConfirmations(account.id, ids, nonces, accept);
      if (success) {
        const action = accept ? t("confirm.accepted") : t("confirm.denied");
        addToast("success", `${action} (${ids.length})`);
        setConfirmations((prev) => prev.filter((c) => !ids.includes(c.id)));
      } else {
        addToast("error", t("confirm.respondFailed"));
      }
    } catch (e: unknown) {
      addToast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setResponding((prev) => {
        const s = new Set(prev);
        ids.forEach((id) => s.delete(id));
        return s;
      });
    }
  };

  const handleAcceptAll = () => {
    if (confirmations.length === 0) return;
    handleRespond(
      confirmations.map((c) => c.id),
      confirmations.map((c) => c.nonce),
      true,
    );
  };

  const handleDenyAll = () => {
    if (confirmations.length === 0) return;
    handleRespond(
      confirmations.map((c) => c.id),
      confirmations.map((c) => c.nonce),
      false,
    );
  };

  return (
    <div className="confirm-overlay" onMouseDown={onClose}>
      <div
        className="bg-dark-800 border border-dark-600 rounded-lg shadow-xl p-5 w-[560px] max-h-[80vh] flex flex-col"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-200">
            {t("confirm.title")} — {account.login}
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors">
            <IconX />
          </button>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-8 text-gray-400 text-sm">
            <IconRefresh className="animate-spin mr-2 w-4 h-4" />
            {t("confirm.loading")}
          </div>
        )}

        {error && (
          <div className="bg-red-900/30 border border-red-700 rounded p-3 text-sm text-red-300 mb-3">
            {error}
          </div>
        )}

        {!loading && !error && confirmations.length === 0 && (
          <p className="text-gray-400 text-sm text-center py-8">{t("confirm.empty")}</p>
        )}

        {!loading && confirmations.length > 0 && (
          <>
            <div className="flex gap-2 mb-3">
              <button onClick={handleAcceptAll} className="btn-primary text-xs flex items-center gap-1">
                <IconCheck className="w-3 h-3" />
                {t("confirm.acceptAll")} ({confirmations.length})
              </button>
              <button onClick={handleDenyAll} className="btn-secondary text-xs flex items-center gap-1">
                <IconX className="w-3 h-3" />
                {t("confirm.denyAll")}
              </button>
              <button onClick={fetchConfs} className="btn-secondary text-xs flex items-center gap-1 ml-auto">
                <IconRefresh className="w-3 h-3" />
                {t("confirm.refresh")}
              </button>
            </div>

            <div className="overflow-y-auto space-y-2 flex-1 min-h-0">
              {confirmations.map((conf) => {
                const busy = responding.has(conf.id);
                return (
                  <div
                    key={conf.id}
                    className={`bg-dark-700 border border-dark-600 rounded p-3 flex items-start gap-3 ${busy ? "opacity-50" : ""}`}
                  >
                    {conf.icon ? (
                      <img src={conf.icon} alt="" className="w-8 h-8 rounded flex-shrink-0 mt-0.5" />
                    ) : (
                      <span className="text-xl flex-shrink-0 mt-0.5">{TYPE_ICONS[conf.type] ?? "❓"}</span>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs px-1.5 py-0.5 rounded bg-dark-600 text-gray-400">
                          {conf.type_name}
                        </span>
                        <span className="text-sm text-gray-200 truncate">{conf.headline}</span>
                      </div>
                      {conf.summary.length > 0 && (
                        <p className="text-xs text-gray-400 truncate">{conf.summary.join(" • ")}</p>
                      )}
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      <button
                        disabled={busy}
                        onClick={() => handleRespond([conf.id], [conf.nonce], true)}
                        className="p-1.5 rounded bg-green-700/60 hover:bg-green-600/80 text-green-200 transition-colors"
                        title={conf.accept}
                      >
                        <IconCheck className="w-3.5 h-3.5" />
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => handleRespond([conf.id], [conf.nonce], false)}
                        className="p-1.5 rounded bg-red-700/60 hover:bg-red-600/80 text-red-200 transition-colors"
                        title={conf.cancel}
                      >
                        <IconX className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
