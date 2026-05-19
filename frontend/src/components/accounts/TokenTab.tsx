import { useEffect, useCallback, useState, useMemo } from "react";
import { api } from "@/api/client";
import { useTokenStore } from "@/stores/tokenStore";
import { useUiStore } from "@/stores/uiStore";
import { ConfirmModal } from "@/components/shared/Modals";
import { StatusBadge, BanBadge, VacBadge, LimitBadge, CountryBadge } from "./Badges";
import { SteamLevelBadge } from "./SteamLevelBadge";
import { TokenImportModal } from "./TokenImportModal";
import { TokenAddModal } from "./TokenAddModal";
import { TokenColumnSettingsDropdown } from "./TokenColumnSettingsDropdown";
import { TokenCheckModal } from "./TokenCheckModal";
import {
  IconDownload,
  IconPlus,
  IconTrash,
  IconPlay,
  IconGlobe,
  IconRefresh,
  IconBan,
  IconCheckCircle,
  IconXCircle,
  IconCheck,
  IconAlertTriangle,
  IconScrollText,
  IconFileText,
} from "@/components/shared/Icons";
import type { Task } from "@/api/types";
import { useT } from "@/lib/i18n";

type AccResults = Record<string, { status: string; error?: string }>;
type AccSteps = Record<string, { step: number; total: number }>;

function parseAccResults(raw: Task["account_results"]): AccResults | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as AccResults;
    } catch {
      return null;
    }
  }
  return raw;
}

export function TokenTab() {
  const accounts = useTokenStore((s) => s.accounts);
  const selectedIds = useTokenStore((s) => s.selectedIds);
  const loadAccounts = useTokenStore((s) => s.loadAccounts);
  const toggleSelect = useTokenStore((s) => s.toggleSelect);
  const clearSelection = useTokenStore((s) => s.clearSelection);
  const setSelectedIds = useTokenStore((s) => s.setSelectedIds);
  const addToast = useUiStore((s) => s.addToast);
  const autoProxyOnImport = useUiStore((s) => s.autoProxyOnImportToken);
  const autoValidateOnImport = useUiStore((s) => s.autoValidateOnImportToken);
  const cols = useUiStore((s) => s.tokenColumnVisibility);
  const loadTokenColumnSettings = useUiStore((s) => s.loadTokenColumnSettings);
  const t = useT();

  const [searchQuery, setSearchQuery] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [confirmModal, setConfirmModal] = useState<{
    open: boolean;
    message: string;
    onConfirm: () => void;
  }>({ open: false, message: "", onConfirm: () => {} });
  const [processingIds, setProcessingIds] = useState<Set<number>>(new Set());
  const [accountResults, setAccountResults] = useState<AccResults>({});
  const [accountSteps, setAccountSteps] = useState<AccSteps>({});
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [checkModalId, setCheckModalId] = useState<number | null>(null);

  useEffect(() => {
    loadAccounts();
    loadTokenColumnSettings();
  }, [loadAccounts, loadTokenColumnSettings]);

  const confirm = (msg: string, fn: () => void) =>
    setConfirmModal({ open: true, message: msg, onConfirm: fn });

  const watchTask = useCallback(
    (taskId: string) => {
      const es = new EventSource(`/api/tasks/${taskId}/stream`);
      es.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data) as Task;
          setActiveTask(data);
          if (data.account_results) {
            const r = parseAccResults(data.account_results);
            if (r) setAccountResults(r);
          }
          if (data.account_steps)
            setAccountSteps(data.account_steps as AccSteps);
          if (data.status !== "running") {
            es.close();
            setProcessingIds(new Set());
            loadAccounts();
          }
        } catch {
          /* ignore */
        }
      };
      es.onerror = () => es.close();
    },
    [loadAccounts],
  );

  const handleValidate = useCallback(async () => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    clearSelection();
    setProcessingIds(new Set(ids));
    setAccountResults({});
    setAccountSteps({});
    try {
      const { task_id } = await api.validateTokens(ids);
      setActiveTask({
        id: task_id,
        type: "token_validate",
        status: "running",
        progress: 0,
        total: ids.length,
        result: null,
        error: null,
        created_at: "",
        updated_at: "",
      });
      watchTask(task_id);
    } catch (err) {
      setProcessingIds(new Set());
      addToast("error", String(err));
    }
  }, [selectedIds, clearSelection, watchTask, addToast]);

  const handleValidateSingle = useCallback(
    async (id: number) => {
      setProcessingIds(new Set([id]));
      setAccountResults((r) => {
        const n = { ...r };
        delete n[String(id)];
        return n;
      });
      setAccountSteps((s) => {
        const n = { ...s };
        delete n[String(id)];
        return n;
      });
      try {
        const { task_id } = await api.validateTokens([id]);
        setActiveTask({
          id: task_id,
          type: "token_validate",
          status: "running",
          progress: 0,
          total: 1,
          result: null,
          error: null,
          created_at: "",
          updated_at: "",
        });
        watchTask(task_id);
      } catch (err) {
        setProcessingIds(new Set());
        addToast("error", String(err));
      }
    },
    [watchTask, addToast],
  );

  const handleFullCheckSingle = useCallback(
    async (id: number) => {
      setProcessingIds(new Set([id]));
      try {
        const { task_id } = await api.fullCheckTokens([id]);
        setActiveTask({
          id: task_id,
          type: "token_full_check",
          status: "running",
          progress: 0,
          total: 1,
          result: null,
          error: null,
          created_at: "",
          updated_at: "",
        });
        watchTask(task_id);
      } catch (err) {
        setProcessingIds(new Set());
        addToast("error", String(err));
      }
    },
    [watchTask, addToast],
  );

  const handleFullCheck = useCallback(async () => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    clearSelection();
    setProcessingIds(new Set(ids));
    setAccountResults({});
    setAccountSteps({});
    try {
      const { task_id } = await api.fullCheckTokens(ids);
      setActiveTask({
        id: task_id,
        type: "token_full_check",
        status: "running",
        progress: 0,
        total: ids.length,
        result: null,
        error: null,
        created_at: "",
        updated_at: "",
      });
      watchTask(task_id);
    } catch (err) {
      setProcessingIds(new Set());
      addToast("error", String(err));
    }
  }, [selectedIds, clearSelection, watchTask, addToast]);

  const handleDownloadCookies = useCallback(
    (account: (typeof accounts)[number]) => {
      if (!account.has_cookies) {
        addToast("warn", "Нет сохранённых куки. Сначала запустите валидацию.");
        return;
      }
      api.downloadTokenCookies(account.id);
    },
    [addToast],
  );

  const handleDeleteSelected = () => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    confirm(
      t("confirm.deleteTokenSelected", { count: ids.length }),
      async () => {
        await api.deleteTokenBulk(ids);
        clearSelection();
        loadAccounts();
      },
    );
  };

  const handleDeleteAll = () => {
    confirm(
      t("confirm.deleteTokenAll", { count: accounts.length }),
      async () => {
        await api.deleteTokenBulk(accounts.map((a) => a.id));
        clearSelection();
        loadAccounts();
      },
    );
  };

  const handleAssignProxies = () => {
    confirm(t("confirm.assignProxies"), async () => {
      try {
        const r = await api.assignTokenProxies();
        addToast(
          "success",
          t("toast.proxiesAssignedShort", { count: r.assigned }),
        );
        loadAccounts();
      } catch (e: unknown) {
        addToast("error", e instanceof Error ? e.message : String(e));
      }
    });
  };

  const handleReassignProxies = () => {
    confirm(t("confirm.reassignProxiesAll"), async () => {
      try {
        const r = await api.reassignTokenProxies();
        addToast(
          "success",
          t("toast.proxiesReassignedShort", { count: r.assigned }),
        );
        loadAccounts();
      } catch (e: unknown) {
        addToast("error", e instanceof Error ? e.message : String(e));
      }
    });
  };

  const handleClearProxies = () => {
    confirm(t("confirm.clearProxies"), async () => {
      try {
        const r = await api.clearTokenProxies();
        addToast(
          "success",
          t("toast.proxiesClearedShort", { count: r.cleared }),
        );
        loadAccounts();
      } catch (e: unknown) {
        addToast("error", e instanceof Error ? e.message : String(e));
      }
    });
  };

  const handleOpenBrowser = async (id: number) => {
    try {
      const result = await api.openTokenBrowser(id);
      if (result.status === "revalidating") {
        addToast("warn", t("toast.cookiesExpiredRevalidating"));
        if (result.task_id) {
          setProcessingIds(new Set([id]));
          setActiveTask({
            id: result.task_id,
            type: "token_validate",
            status: "running",
            progress: 0,
            total: 1,
            result: null,
            error: null,
            created_at: "",
            updated_at: "",
          });
          watchTask(result.task_id);
        }
      } else {
        addToast("success", t("toast.browserOpening"));
      }
    } catch (e: unknown) {
      addToast("error", e instanceof Error ? e.message : String(e));
    }
  };

  const handleAfterTokenImport = useCallback(
    async (newIds: number[]) => {
      let proxyOn = autoProxyOnImport;
      let validateOn = autoValidateOnImport;
      try {
        const fresh = await api.getValidationSettings();
        proxyOn = fresh.auto_proxy_on_import_token;
        validateOn = fresh.auto_validate_on_import_token;
      } catch {
        /* fall back to stale store values */
      }

      if (proxyOn) {
        try {
          const r = await api.assignTokenProxies();
          addToast(
            "success",
            t("toast.proxiesAssignedShort", { count: r.assigned }),
          );
          await loadAccounts();
        } catch {
          /* ignore */
        }
      }
      if (validateOn && newIds.length) {
        try {
          const { task_id } = await api.validateTokens(newIds);
          setActiveTask({
            id: task_id,
            type: "token_validate",
            status: "running",
            progress: 0,
            total: newIds.length,
            result: null,
            error: null,
            created_at: "",
            updated_at: "",
          });
          setProcessingIds(new Set(newIds));
          watchTask(task_id);
        } catch (e: unknown) {
          setProcessingIds(new Set());
          addToast("error", e instanceof Error ? e.message : String(e));
        }
      }
    },
    [
      autoProxyOnImport,
      autoValidateOnImport,
      addToast,
      loadAccounts,
      watchTask,
      t,
    ],
  );

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return accounts;
    const q = searchQuery.trim();

    const lvlMatch = q.match(/^lvl\s*(>=|<=|>|<|=)\s*(\d+)$/i);
    if (lvlMatch) {
      const op = lvlMatch[1];
      const val = parseInt(lvlMatch[2], 10);
      return accounts.filter((a) => {
        const lvl = a.steam_level;
        if (lvl == null) return false;
        if (op === ">") return lvl > val;
        if (op === ">=") return lvl >= val;
        if (op === "<") return lvl < val;
        if (op === "<=") return lvl <= val;
        return lvl === val;
      });
    }

    const ql = q.toLowerCase();

    if (ql === "vac") return accounts.filter((a) => a.vac_status === "VAC" || a.vac_status === "GAME BAN");
    if (ql === "clean") return accounts.filter((a) => a.vac_status === "CLEAN");
    if (ql === "lim") return accounts.filter((a) => a.limit_status === "Lim");
    if (ql === "nolim") return accounts.filter((a) => a.limit_status === "NoLim");
    if (ql === "ban" || ql === "banned") return accounts.filter((a) => a.ban_status === "BANNED");

    const countryM = ql.match(/^country:(.+)$/);
    if (countryM) {
      const cv = countryM[1].trim();
      return accounts.filter((a) => a.country?.toLowerCase().includes(cv));
    }

    const balMatch = ql.match(/^(?:balance|usd|eur|rub|cny|gbp|cad|aud|brl|try|jpy|krw|inr|pln|nok|sek|dkk|chf|hkd|sgd|nzd|mxn|vnd)([<>]=?)(\d+\.?\d*)$/);
    if (balMatch) {
      const op = balMatch[1];
      const threshold = parseFloat(balMatch[2]);
      const parseNum = (b: string | null) => {
        if (!b) return NaN;
        const m = b.match(/[\d,]+\.?\d*/);
        return m ? parseFloat(m[0].replace(/,/g, "")) : NaN;
      };
      return accounts.filter((a) => {
        const n = parseNum(a.balance);
        if (isNaN(n)) return false;
        if (op === ">") return n > threshold;
        if (op === ">=") return n >= threshold;
        if (op === "<") return n < threshold;
        if (op === "<=") return n <= threshold;
        return false;
      });
    }

    return accounts.filter(
      (a) =>
        (a.login ?? "").toLowerCase().includes(ql) ||
        (a.steam_id ?? "").toLowerCase().includes(ql) ||
        (a.nickname ?? "").toLowerCase().includes(ql) ||
        (a.country ?? "").toLowerCase().includes(ql) ||
        (a.notes ?? "").toLowerCase().includes(ql),
    );
  }, [accounts, searchQuery]);

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((a) => selectedIds.has(a.id));
  const toggleSelectAllFiltered = () => {
    if (allFilteredSelected) {
      const next = new Set(selectedIds);
      filtered.forEach((a) => next.delete(a.id));
      setSelectedIds(next);
    } else {
      const next = new Set(selectedIds);
      filtered.forEach((a) => next.add(a.id));
      setSelectedIds(next);
    }
  };

  const proxyLabels = useMemo(() => {
    const map = new Map<number, string>();
    const unique: string[] = [];
    for (const a of accounts) {
      if (a.proxy && !unique.includes(a.proxy)) unique.push(a.proxy);
    }
    const proxyToNum = new Map<string, number>();
    unique.forEach((p, i) => proxyToNum.set(p, i + 1));
    for (const a of accounts) {
      if (a.proxy)
        map.set(a.id, t("proxy.label", { num: proxyToNum.get(a.proxy) ?? 0 }));
    }
    return map;
  }, [accounts, t]);

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">
      {/* Toolbar */}
      <div className="bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 flex flex-wrap items-center gap-2 shrink-0">
        <button onClick={() => setShowImport(true)} className="btn-primary">
          <IconDownload size={14} className="inline mr-1" />
          {t("btn.import")}
        </button>
        <button onClick={() => setShowAdd(true)} className="btn-secondary">
          <IconPlus size={14} className="inline mr-1" />
          {t("btn.add")}
        </button>

        {/* Progress indicator */}
        {activeTask && (
          <>
            <div className="h-5 border-l border-dark-500" />
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs text-gray-400 whitespace-nowrap">
                {t("task.validate")}
              </span>
              <div className="w-28 bg-dark-600 rounded-full h-2.5 shrink-0">
                <div
                  className={`h-2.5 rounded-full transition-all duration-300 ${
                    activeTask.status === "completed"
                      ? "bg-green-500"
                      : activeTask.status === "failed"
                        ? "bg-red-500"
                        : "bg-accent"
                  }`}
                  style={{
                    width: `${
                      activeTask.total > 1
                        ? activeTask.total > 0
                          ? Math.round(
                              (activeTask.progress / activeTask.total) * 100,
                            )
                          : 0
                        : activeTask.total_steps
                          ? Math.round(
                              ((activeTask.step ?? 0) /
                                activeTask.total_steps) *
                                100,
                            )
                          : 0
                    }%`,
                  }}
                />
              </div>
              <span className="text-xs text-gray-500 whitespace-nowrap">
                {activeTask.total > 1
                  ? `${activeTask.progress}/${activeTask.total}${activeTask.active_count ? ` (${activeTask.active_count})` : ""}`
                  : activeTask.step_label ||
                    `${activeTask.progress}/${activeTask.total}`}
                {activeTask.total > 1
                  ? ` (${activeTask.total > 0 ? Math.round((activeTask.progress / activeTask.total) * 100) : 0}%)`
                  : activeTask.total_steps
                    ? ` (${activeTask.step}/${activeTask.total_steps})`
                    : ""}
              </span>
              {activeTask.status === "completed" && (
                <IconCheckCircle size={14} className="text-green-400" />
              )}
              {activeTask.status === "failed" && (
                <span title={activeTask.error || ""}>
                  <IconXCircle size={14} className="text-red-400" />
                </span>
              )}
            </div>
          </>
        )}

        <div className="ml-auto flex items-center gap-2">
          <TokenColumnSettingsDropdown />
          <div className="h-5 border-l border-dark-500" />
          <button
            onClick={handleDeleteSelected}
            className="btn-danger-outline text-xs"
          >
            {t("btn.deleteSelected")}
          </button>
          <button onClick={handleDeleteAll} className="btn-danger text-xs">
            {t("btn.deleteAll")}
          </button>
        </div>
      </div>

      {/* Table with action bar */}
      <div className="bg-dark-800 border border-dark-600 rounded-lg overflow-hidden flex-1 min-h-0 flex flex-col">
        {/* Action bar */}
        <div className="px-3 py-2 flex items-center gap-2 border-b border-dark-600 shrink-0 bg-dark-800">
          <button
            onClick={handleValidate}
            disabled={selectedIds.size === 0 || processingIds.size > 0}
            className="btn-accent text-sm disabled:opacity-40"
          >
            <IconPlay size={12} className="inline mr-1" />
            {t("btn.validate")}
          </button>
          <button
            onClick={handleFullCheck}
            disabled={selectedIds.size === 0 || processingIds.size > 0}
            className="btn-secondary text-sm disabled:opacity-40"
          >
            <IconScrollText size={12} className="inline mr-1" />
            {t("btn.fullCheck")}
          </button>
          <div className="h-5 border-l border-dark-500" />
          <button
            onClick={handleAssignProxies}
            className="btn-secondary text-sm"
          >
            <IconGlobe size={14} className="inline mr-1" />
            {t("btn.assignProxies")}
          </button>
          <button
            onClick={handleReassignProxies}
            className="btn-secondary text-sm"
          >
            <IconRefresh size={14} className="inline mr-1" />
            {t("btn.reassign")}
          </button>
          <button
            onClick={handleClearProxies}
            className="btn-danger-outline text-sm"
          >
            <IconBan size={14} className="inline mr-1" />
            {t("btn.clearProxies")}
          </button>
          <div className="ml-auto">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("ph.search")}
              className="bg-dark-700 border border-dark-600 rounded px-2 py-1.5 text-xs w-80 placeholder:text-gray-500 outline-none focus:border-accent"
            />
          </div>
        </div>

        {/* Table */}
        <div className="overflow-auto flex-1 min-h-0">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-dark-800 z-10">
              <tr className="text-left text-xs text-gray-500 border-b border-dark-600">
                <th className="px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={allFilteredSelected}
                      onChange={toggleSelectAllFiltered}
                    />
                    {selectedIds.size > 0 && (
                      <span className="text-accent font-medium">
                        {selectedIds.size}
                      </span>
                    )}
                  </div>
                </th>
                <th className="w-5" />
                {cols.browser && (
                  <th className="px-3 py-2">{t("col.browser")}</th>
                )}
                {cols.profile && (
                  <th className="px-3 py-2">{t("col.profile")}</th>
                )}
                {cols.last_online && (
                  <th className="px-3 py-2">{t("col.lastOnline")}</th>
                )}
                {cols.steam_id && <th className="px-3 py-2">Steam ID</th>}
                {cols.login && <th className="px-3 py-2">{t("col.login")}</th>}
                {cols.token && <th className="px-3 py-2">{t("col.token")}</th>}
                {cols.status && (
                  <th className="px-3 py-2">{t("col.status")}</th>
                )}
                {cols.ban && <th className="px-3 py-2">{t("col.ban")}</th>}
                {cols.vac && <th className="px-3 py-2">{t("col.vac")}</th>}
                {cols.limit && <th className="px-3 py-2">{t("col.limit")}</th>}
                {cols.balance && <th className="px-3 py-2">{t("col.balance")}</th>}
                {cols.country && <th className="px-3 py-2">{t("col.country")}</th>}
                {cols.proxy && <th className="px-3 py-2">{t("col.proxy")}</th>}
                {cols.notes && <th className="px-3 py-2">{t("col.notes")}</th>}
                {cols.actions && (
                  <th className="px-3 py-2">{t("col.actions")}</th>
                )}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={12} className="text-center py-12 text-gray-500">
                    {t("empty.tokens")}
                  </td>
                </tr>
              ) : (
                filtered.map((a) => {
                  const isProcessing = processingIds.has(a.id);
                  const result = accountResults[String(a.id)];
                  const step = accountSteps[String(a.id)];
                  return (
                    <tr
                      key={a.id}
                      className="hover:bg-dark-700/50 transition border-t border-dark-700"
                    >
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(a.id)}
                          onChange={() => toggleSelect(a.id)}
                        />
                      </td>
                      {/* Status icon */}
                      <td className="px-1 py-2 w-5">
                        {isProcessing ? (
                          <div className="flex items-center gap-1">
                            <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin shrink-0" />
                            {step && (
                              <span className="text-[10px] text-gray-500 whitespace-nowrap">
                                [{step.step}/{step.total}]
                              </span>
                            )}
                          </div>
                        ) : result?.status === "ok" ? (
                          <IconCheck size={16} className="text-gray-400" />
                        ) : result?.status === "error" ? (
                          <span title={result.error}>
                            <IconAlertTriangle
                              size={16}
                              className="text-red-400"
                            />
                          </span>
                        ) : null}
                      </td>
                      {cols.browser && (
                        <td className="px-3 py-2 whitespace-nowrap text-center">
                          {a.has_cookies ? (
                            <button
                              onClick={() => handleOpenBrowser(a.id)}
                              className="px-2 py-0.5 text-xs font-medium rounded bg-blue-600/20 text-blue-400 border border-blue-500/30 hover:bg-blue-600/40 hover:text-blue-300 active:scale-95 transition"
                              title={t("tip.openBrowser")}
                            >
                              {t("col.browser")}
                            </button>
                          ) : (
                            <span className="text-gray-600 text-xs">—</span>
                          )}
                        </td>
                      )}
                      {cols.profile && (
                        <td className="px-3 py-2 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            {a.avatar_url && (
                              <img
                                src={a.avatar_url}
                                className="avatar-sm"
                                alt=""
                              />
                            )}
                            <span className="text-xs">{a.nickname || "—"}</span>
                            {a.steam_level != null && (
                              <SteamLevelBadge level={a.steam_level} />
                            )}
                          </div>
                        </td>
                      )}
                      {cols.last_online && (
                        <td className="px-3 py-2 text-xs text-gray-400 whitespace-nowrap">
                          {a.last_online || "—"}
                        </td>
                      )}
                      {cols.steam_id && (
                        <td className="px-3 py-2 text-xs">
                          {a.steam_id ? (
                            <a
                              href={`https://steamcommunity.com/profiles/${encodeURIComponent(a.steam_id)}/`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-400 hover:text-blue-300 hover:underline"
                            >
                              {a.steam_id}
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                      )}
                      {cols.login && (
                        <td className="px-3 py-2 font-medium">
                          {a.login ?? "—"}
                        </td>
                      )}
                      {cols.token && (
                        <td
                          className="px-3 py-2 font-mono text-gray-400 truncate max-w-[180px]"
                          title={a.token}
                        >
                          {a.token.slice(0, 24)}…
                        </td>
                      )}
                      {cols.status && (
                        <td className="px-3 py-2">
                          <StatusBadge status={a.status} />
                        </td>
                      )}
                      {cols.ban && (
                        <td className="px-3 py-2">
                          <BanBadge status={a.ban_status} />
                        </td>
                      )}
                      {cols.vac && (
                        <td className="px-3 py-2">
                          <VacBadge status={a.vac_status} games={a.vac_games} />
                        </td>
                      )}
                      {cols.limit && (
                        <td className="px-3 py-2">
                          <LimitBadge status={a.limit_status} />
                        </td>
                      )}
                      {cols.balance && (
                        <td className="px-3 py-2 text-xs font-mono text-gray-300 whitespace-nowrap">
                          {a.balance || "—"}
                        </td>
                      )}
                      {cols.country && (
                        <td className="px-3 py-2">
                          <CountryBadge country={a.country} />
                        </td>
                      )}
                      {cols.proxy && (
                        <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">
                          {proxyLabels.get(a.id) ?? "—"}
                        </td>
                      )}
                      {cols.notes && (
                        <td className="px-3 py-2 text-xs text-gray-500">
                          {a.notes ?? "—"}
                        </td>
                      )}
                      {cols.actions && (
                        <td className="px-3 py-2 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => handleValidateSingle(a.id)}
                              disabled={isProcessing}
                              className="text-gray-400 hover:text-accent disabled:opacity-40 transition"
                              title={t("tip.validate")}
                            >
                              <IconPlay size={14} />
                            </button>
                            <button
                              onClick={() => handleFullCheckSingle(a.id)}
                              disabled={isProcessing}
                              className="text-gray-400 hover:text-accent disabled:opacity-40 transition"
                              title={t("btn.fullCheck")}
                            >
                              <IconScrollText size={14} />
                            </button>
                            <button
                              onClick={() => setCheckModalId(a.id)}
                              className="text-gray-400 hover:text-blue-400 transition"
                              title="Детали проверки"
                            >
                              <IconFileText size={14} />
                            </button>
                            <button
                              onClick={() => handleDownloadCookies(a)}
                              className={`transition ${
                                a.has_cookies
                                  ? "text-gray-400 hover:text-green-400"
                                  : "text-gray-700 cursor-not-allowed"
                              }`}
                              title={
                                a.has_cookies
                                  ? "Скачать куки"
                                  : "Куки отсутствуют"
                              }
                            >
                              <IconDownload size={14} />
                            </button>
                            <button
                              onClick={() =>
                                confirm(
                                  t("confirm.deleteToken", {
                                    name: a.login ?? a.token.slice(0, 16),
                                  }),
                                  async () => {
                                    await api.deleteTokenAccount(a.id);
                                    loadAccounts();
                                  },
                                )
                              }
                              className="text-gray-400 hover:text-red-400 transition"
                              title={t("tip.delete")}
                            >
                              <IconTrash size={14} />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showImport && (
        <TokenImportModal
          onClose={() => setShowImport(false)}
          onImportDone={handleAfterTokenImport}
        />
      )}
      {showAdd && <TokenAddModal onClose={() => setShowAdd(false)} />}
      {checkModalId != null &&
        (() => {
          const acc = accounts.find((a) => a.id === checkModalId);
          return acc ? (
            <TokenCheckModal
              account={acc}
              onClose={() => setCheckModalId(null)}
              onRecheck={() => {
                setCheckModalId(null);
                handleFullCheckSingle(acc.id);
              }}
            />
          ) : null;
        })()}
      {confirmModal.open && (
        <ConfirmModal
          message={confirmModal.message}
          onConfirm={() => {
            confirmModal.onConfirm();
            setConfirmModal((p) => ({ ...p, open: false }));
          }}
          onCancel={() => setConfirmModal((p) => ({ ...p, open: false }))}
        />
      )}
    </div>
  );
}
