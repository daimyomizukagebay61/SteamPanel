import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { api } from "@/api/client";
import { useLogpassStore } from "@/stores/logpassStore";
import { useUiStore } from "@/stores/uiStore";
import { ConfirmModal } from "@/components/shared/Modals";
import { LogpassImportModal } from "./LogpassImportModal";
import { LogpassAddModal } from "./LogpassAddModal";
import { LogpassEditModal } from "./LogpassEditModal";
import { LogpassColumnSettingsDropdown } from "./LogpassColumnSettingsDropdown";
import { StatusBadge, BanBadge, VacBadge, LimitBadge, CountryBadge } from "./Badges";
import { SteamLevelBadge } from "./SteamLevelBadge";
import { copyText } from "@/lib/clipboard";
import {
  IconDownload,
  IconPlus,
  IconPlay,
  IconTrash,
  IconCheckCircle,
  IconXCircle,
  IconEye,
  IconEyeOff,
  IconGlobe,
  IconRefresh,
  IconBan,
  IconCheck,
  IconAlertTriangle,
  IconEdit,
} from "@/components/shared/Icons";
import type { Task, LogpassColumnSettings } from "@/api/types";
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

export function LogpassTab() {
  const accounts = useLogpassStore((s) => s.accounts);
  const selectedIds = useLogpassStore((s) => s.selectedIds);
  const loadAccounts = useLogpassStore((s) => s.loadAccounts);
  const clearSelection = useLogpassStore((s) => s.clearSelection);
  const setSelectedIds = useLogpassStore((s) => s.setSelectedIds);
  const addToast = useUiStore((s) => s.addToast);
  const autoProxyOnImport = useUiStore((s) => s.autoProxyOnImportLogpass);
  const autoValidateOnImport = useUiStore((s) => s.autoValidateOnImportLogpass);
  const cols = useUiStore((s) => s.logpassColumnVisibility);
  const t = useT();

  const [searchQuery, setSearchQuery] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [editAccountId, setEditAccountId] = useState<number | null>(null);
  const [confirmModal, setConfirmModal] = useState<{
    open: boolean;
    message: string;
    onConfirm: () => void;
  }>({ open: false, message: "", onConfirm: () => {} });
  const [processingIds, setProcessingIds] = useState<Set<number>>(new Set());
  const [accountResults, setAccountResults] = useState<AccResults>({});
  const [accountSteps, setAccountSteps] = useState<AccSteps>({});
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const BATCH = 100;
  const [visibleCount, setVisibleCount] = useState(BATCH);

  type SortField = "last_online" | "prime" | "trophy" | "behavior" | null;
  type SortDir = "asc" | "desc";
  const [sortField, setSortField] = useState<SortField>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      if (sortDir === "asc") setSortDir("desc");
      else {
        setSortField(null);
        setSortDir("asc");
      }
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };
  const sentinelRef = useRef<HTMLTableRowElement>(null);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

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
            setActiveTask(null);
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
      const { task_id } = await api.validateLogpass(ids);
      setActiveTask({
        id: task_id,
        type: "logpass_validate",
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
        const { task_id } = await api.validateLogpass([id]);
        setActiveTask({
          id: task_id,
          type: "logpass_validate",
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

  const handleFullParse = useCallback(async () => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    clearSelection();
    setProcessingIds(new Set(ids));
    setAccountResults({});
    setAccountSteps({});
    try {
      const { task_id } = await api.fullParseLogpass(ids);
      setActiveTask({
        id: task_id,
        type: "logpass_full_parse",
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

  const handleDeleteSelected = () => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    confirm(
      t("confirm.deleteLogpassSelected", { count: ids.length }),
      async () => {
        await api.deleteLogpassBulk(ids);
        clearSelection();
        loadAccounts();
      },
    );
  };

  const handleDeleteAll = () => {
    confirm(
      t("confirm.deleteLogpassAll", { count: accounts.length }),
      async () => {
        await api.deleteLogpassBulk(accounts.map((a) => a.id));
        clearSelection();
        loadAccounts();
      },
    );
  };

  const handleAssignProxies = () => {
    confirm(t("confirm.assignProxies"), async () => {
      try {
        const r = await api.assignLogpassProxies();
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
        const r = await api.reassignLogpassProxies();
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
        const r = await api.clearLogpassProxies();
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

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return accounts;
    const q = searchQuery.trim();

    // lvl comparison syntax: lvl>10, lvl<10, lvl>=10, lvl<=10, lvl=10
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
    if (ql === "noban" || ql === "no ban") return accounts.filter((a) => a.ban_status === "NO BAN");

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
        a.login.toLowerCase().includes(ql) ||
        (a.steam_id ?? "").toLowerCase().includes(ql) ||
        (a.nickname ?? "").toLowerCase().includes(ql) ||
        (a.notes ?? "").toLowerCase().includes(ql) ||
        (a.country ?? "").toLowerCase().includes(ql) ||
        (a.license ?? "").toLowerCase().includes(ql),
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

  const sorted = useMemo(() => {
    if (!sortField) return filtered;
    const dir = sortDir === "asc" ? 1 : -1;
    const EMPTY = Symbol();
    return [...filtered].sort((a, b) => {
      let va: number | typeof EMPTY = EMPTY;
      let vb: number | typeof EMPTY = EMPTY;
      if (sortField === "last_online") {
        const parseOnline = (
          v: string | null | undefined,
        ): number | typeof EMPTY => {
          if (!v || v === "\u2014") return EMPTY;
          if (v === "online") return -1;
          const m = v.match(/^(\d+)([mhd])$/i);
          if (!m) return EMPTY;
          const n = parseInt(m[1], 10);
          if (m[2] === "m") return n;
          if (m[2] === "h") return n * 60;
          return n * 1440;
        };
        va = parseOnline(a.last_online);
        vb = parseOnline(b.last_online);
      } else if (sortField === "prime") {
        va = a.prime === "Enabled" ? 0 : a.prime === "Disabled" ? 1 : EMPTY;
        vb = b.prime === "Enabled" ? 0 : b.prime === "Disabled" ? 1 : EMPTY;
      } else if (sortField === "trophy") {
        va =
          a.trophy != null && a.trophy !== "\u2014"
            ? parseInt(a.trophy, 10) || 0
            : EMPTY;
        vb =
          b.trophy != null && b.trophy !== "\u2014"
            ? parseInt(b.trophy, 10) || 0
            : EMPTY;
      } else if (sortField === "behavior") {
        va =
          a.behavior != null && a.behavior !== "\u2014"
            ? parseInt(a.behavior, 10) || 0
            : EMPTY;
        vb =
          b.behavior != null && b.behavior !== "\u2014"
            ? parseInt(b.behavior, 10) || 0
            : EMPTY;
      }
      // Empty values always sink to the bottom
      if (va === EMPTY && vb === EMPTY) return 0;
      if (va === EMPTY) return 1;
      if (vb === EMPTY) return -1;
      if (va === vb) return 0;
      return (va < vb ? -1 : 1) * dir;
    });
  }, [filtered, sortField, sortDir]);

  useEffect(() => {
    setVisibleCount(BATCH);
  }, [searchQuery, sortField, sortDir]);

  const visible = useMemo(
    () => sorted.slice(0, visibleCount),
    [sorted, visibleCount],
  );

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting)
          setVisibleCount((c) => Math.min(c + BATCH, sorted.length));
      },
      { rootMargin: "400px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [sorted.length, visibleCount]);

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
  }, [accounts]);

  const handleOpenBrowser = async (id: number) => {
    try {
      const result = await api.openLogpassBrowser(id);
      if (result.status === "revalidating") {
        addToast("warn", t("toast.cookiesExpiredRevalidating"));
        if (result.task_id) {
          setProcessingIds(new Set([id]));
          setActiveTask({
            id: result.task_id,
            type: "logpass_validate",
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

  const handleAfterLogpassImport = useCallback(
    async (newIds: number[]) => {
      let proxyOn = autoProxyOnImport;
      let validateOn = autoValidateOnImport;
      try {
        const fresh = await api.getValidationSettings();
        proxyOn = fresh.auto_proxy_on_import_logpass;
        validateOn = fresh.auto_validate_on_import_logpass;
      } catch {
        /* fall back to stale store values */
      }

      if (proxyOn) {
        try {
          const r = await api.assignLogpassProxies();
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
          const { task_id } = await api.validateLogpass(newIds);
          setActiveTask({
            id: task_id,
            type: "logpass_validate",
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

        {/* Progress indicator — exact match to AccountsTab */}
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
          <LogpassColumnSettingsDropdown />
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
            onClick={handleFullParse}
            disabled={selectedIds.size === 0 || processingIds.size > 0}
            className="btn-secondary text-sm disabled:opacity-40"
          >
            <IconPlay size={12} className="inline mr-1" />
            {t("btn.fullParse")}
          </button>
          {activeTask && activeTask.status === "running" && (
            <button
              onClick={async () => {
                try {
                  await api.cancelTask(activeTask.id);
                } catch {}
              }}
              className="btn-danger text-sm"
            >
              <IconXCircle size={12} className="inline mr-1" />
              {t("btn.cancel")}
            </button>
          )}
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
              placeholder={t("ph.searchLogpass")}
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
                  <th
                    className="px-3 py-2 cursor-pointer select-none hover:text-gray-300"
                    onClick={() => toggleSort("last_online")}
                  >
                    {t("col.lastOnline")}
                    {sortField === "last_online"
                      ? sortDir === "asc"
                        ? " ▲"
                        : " ▼"
                      : ""}
                  </th>
                )}
                {cols.steam_id && <th className="px-3 py-2">Steam ID</th>}
                {cols.login && <th className="px-3 py-2">{t("col.login")}</th>}
                {cols.password && (
                  <th className="px-3 py-2">{t("col.password")}</th>
                )}
                {cols.login_pass && <th className="px-3 py-2">Login:Pass</th>}
                {cols.status && (
                  <th className="px-3 py-2">{t("col.status")}</th>
                )}
                {cols.ban && <th className="px-3 py-2">{t("col.ban")}</th>}
                {cols.vac && <th className="px-3 py-2">{t("col.vac")}</th>}
                {cols.limit && <th className="px-3 py-2">{t("col.limit")}</th>}
                {cols.balance && <th className="px-3 py-2">{t("col.balance")}</th>}
                {cols.country && <th className="px-3 py-2">{t("col.country")}</th>}
                {cols.prime && (
                  <th
                    className="px-3 py-2 cursor-pointer select-none hover:text-gray-300"
                    onClick={() => toggleSort("prime")}
                  >
                    Prime
                    {sortField === "prime"
                      ? sortDir === "asc"
                        ? " ▲"
                        : " ▼"
                      : ""}
                  </th>
                )}
                {cols.trophy && (
                  <th
                    className="px-3 py-2 cursor-pointer select-none hover:text-gray-300"
                    onClick={() => toggleSort("trophy")}
                  >
                    Trophy
                    {sortField === "trophy"
                      ? sortDir === "asc"
                        ? " ▲"
                        : " ▼"
                      : ""}
                  </th>
                )}
                {cols.behavior && (
                  <th
                    className="px-3 py-2 cursor-pointer select-none hover:text-gray-300"
                    onClick={() => toggleSort("behavior")}
                  >
                    Behavior
                    {sortField === "behavior"
                      ? sortDir === "asc"
                        ? " ▲"
                        : " ▼"
                      : ""}
                  </th>
                )}
                {cols.license && (
                  <th className="px-3 py-2">{t("col.license")}</th>
                )}
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
                  <td colSpan={16} className="text-center py-12 text-gray-500">
                    {t("empty.logpass")}
                  </td>
                </tr>
              ) : (
                <>
                  {visible.map((a) => (
                    <LogpassRow
                      key={a.id}
                      account={a}
                      cols={cols}
                      isProcessing={processingIds.has(a.id)}
                      accountResult={accountResults[String(a.id)]}
                      accountStep={accountSteps[String(a.id)]}
                      proxyLabel={proxyLabels.get(a.id) ?? null}
                      onDelete={(id) =>
                        confirm(
                          t("confirm.deleteLogpass", { name: a.login }),
                          async () => {
                            await api.deleteLogpassAccount(id);
                            loadAccounts();
                          },
                        )
                      }
                      onOpenBrowser={handleOpenBrowser}
                      onValidate={handleValidateSingle}
                      onEdit={(id) => setEditAccountId(id)}
                    />
                  ))}
                  {visibleCount < filtered.length && (
                    <tr ref={sentinelRef}>
                      <td
                        colSpan={16}
                        className="text-center py-3 text-xs text-gray-500"
                      >
                        {t("paging.shown", {
                          visible: visibleCount,
                          total: filtered.length,
                        })}
                      </td>
                    </tr>
                  )}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editAccountId != null &&
        (() => {
          const acc = accounts.find((a) => a.id === editAccountId);
          return acc ? (
            <LogpassEditModal
              account={acc}
              onClose={() => setEditAccountId(null)}
            />
          ) : null;
        })()}
      {showImport && (
        <LogpassImportModal
          onClose={() => setShowImport(false)}
          onImportDone={handleAfterLogpassImport}
        />
      )}
      {showAdd && <LogpassAddModal onClose={() => setShowAdd(false)} />}
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

/* ─── Row component ─── */

function LogpassRow({
  account: a,
  cols,
  isProcessing,
  accountResult,
  accountStep,
  proxyLabel,
  onDelete,
  onOpenBrowser,
  onValidate,
  onEdit,
}: {
  account: import("@/api/types").LogpassAccount;
  cols: LogpassColumnSettings;
  isProcessing: boolean;
  accountResult?: { status: string; error?: string };
  accountStep?: { step: number; total: number };
  proxyLabel: string | null;
  onDelete: (id: number) => void;
  onOpenBrowser: (id: number) => void;
  onValidate: (id: number) => void;
  onEdit: (id: number) => void;
}) {
  const selectedIds = useLogpassStore((s) => s.selectedIds);
  const toggleSelect = useLogpassStore((s) => s.toggleSelect);
  const addToast = useUiStore((s) => s.addToast);
  const hidePasswords = useUiStore((s) => s.hidePasswords);
  const loadAccounts = useLogpassStore((s) => s.loadAccounts);
  const [revealed, setRevealed] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState(a.notes || "");
  const [licExpanded, setLicExpanded] = useState(false);

  const t = useT();
  const masked = hidePasswords && !revealed;
  const dots = "••••••••";

  const handleCopy = async (text: string) => {
    const ok = await copyText(text);
    addToast(
      ok ? "success" : "error",
      ok ? t("toast.copied") : t("toast.copyFailed"),
    );
  };

  return (
    <tr className="hover:bg-dark-700/50 transition">
      <td className="px-3 py-2">
        <input
          type="checkbox"
          checked={selectedIds.has(a.id)}
          onChange={() => toggleSelect(a.id)}
        />
      </td>
      {/* Progress/status icon */}
      <td className="px-1 py-2 w-5">
        {isProcessing ? (
          <div className="flex items-center gap-1">
            <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin shrink-0" />
            {accountStep && (
              <span className="text-[10px] text-gray-500 whitespace-nowrap">
                [{accountStep.step}/{accountStep.total}]
              </span>
            )}
          </div>
        ) : accountResult?.status === "ok" ? (
          <IconCheck size={16} className="text-gray-400" />
        ) : accountResult?.status === "error" ? (
          <span title={accountResult.error}>
            <IconAlertTriangle size={16} className="text-red-400" />
          </span>
        ) : null}
      </td>
      {/* Browser login button */}
      {cols.browser && (
        <td className="px-3 py-2 whitespace-nowrap text-center">
          {a.has_cookies ? (
            <button
              onClick={() => onOpenBrowser(a.id)}
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
      {/* Profile — avatar + nickname + level */}
      {cols.profile && (
        <td className="px-3 py-2 whitespace-nowrap">
          <div className="flex items-center gap-1.5">
            {a.avatar_url && (
              <img src={a.avatar_url} className="avatar-sm" alt="" />
            )}
            <span className="text-xs">{a.nickname || "—"}</span>
            {a.steam_level != null && <SteamLevelBadge level={a.steam_level} />}
          </div>
        </td>
      )}
      {/* Last online */}
      {cols.last_online && (
        <td className="px-3 py-2 text-xs text-gray-400 whitespace-nowrap">
          {a.last_online || "—"}
        </td>
      )}
      {/* Steam ID */}
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
      {/* Login */}
      {cols.login && <td className="px-3 py-2 font-medium">{a.login}</td>}
      {/* Password */}
      {cols.password && (
        <td className="px-3 py-2 text-gray-400 select-none whitespace-nowrap">
          <span
            className="cursor-pointer"
            onClick={() => handleCopy(a.password)}
            title={t("tip.copyPassword")}
          >
            {masked ? dots : a.password}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setRevealed(!revealed);
            }}
            className="ml-1.5 text-gray-500 hover:text-gray-300 inline-flex align-middle"
            title={masked ? t("tip.show") : t("tip.hide")}
          >
            {masked ? <IconEye size={14} /> : <IconEyeOff size={14} />}
          </button>
        </td>
      )}
      {/* Login:Pass */}
      {cols.login_pass && (
        <td className="px-3 py-2 text-gray-400 text-xs select-none whitespace-nowrap">
          <span
            className="cursor-pointer"
            onClick={() => handleCopy(`${a.login}:${a.password}`)}
            title={t("tip.copyLoginPass")}
          >
            {masked ? `${a.login}:${dots}` : `${a.login}:${a.password}`}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setRevealed(!revealed);
            }}
            className="ml-1.5 text-gray-500 hover:text-gray-300 inline-flex align-middle"
            title={masked ? t("tip.show") : t("tip.hide")}
          >
            {masked ? <IconEye size={14} /> : <IconEyeOff size={14} />}
          </button>
        </td>
      )}
      {/* Status */}
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
      {/* Prime, Trophy, Behavior */}
      {cols.prime && (
        <td className="px-3 py-2 text-xs text-gray-400">{a.prime ?? "—"}</td>
      )}
      {cols.trophy && (
        <td className="px-3 py-2 text-xs text-gray-400">{a.trophy ?? "—"}</td>
      )}
      {cols.behavior && (
        <td className="px-3 py-2 text-xs text-gray-400">{a.behavior ?? "—"}</td>
      )}
      {/* License — expandable on click */}
      {cols.license && (
        <td
          className={`px-3 py-2 text-xs text-gray-400 cursor-pointer select-none ${licExpanded ? "max-w-none whitespace-normal break-words" : "truncate max-w-[200px] whitespace-nowrap"}`}
          title={licExpanded ? undefined : (a.license ?? "")}
          onClick={() => setLicExpanded((v) => !v)}
        >
          {a.license ?? "—"}
        </td>
      )}
      {/* Proxy */}
      {cols.proxy && (
        <td className="px-3 py-2 text-xs">
          {a.proxy ? (
            <span
              className="text-blue-400 cursor-pointer hover:underline"
              onClick={() => handleCopy(a.proxy!)}
              title={a.proxy}
            >
              {proxyLabel || a.proxy}
            </span>
          ) : (
            "—"
          )}
        </td>
      )}
      {/* Notes — inline editable */}
      {cols.notes && (
        <td className="px-3 py-2 text-xs max-w-[180px]">
          {editingNotes ? (
            <input
              autoFocus
              className="w-full bg-dark-600 border border-dark-500 rounded px-1.5 py-0.5 text-xs text-gray-200 outline-none focus:border-accent"
              value={notesValue}
              onChange={(e) => setNotesValue(e.target.value)}
              onBlur={async () => {
                setEditingNotes(false);
                if (notesValue !== (a.notes || "")) {
                  try {
                    await api.updateLogpassAccount(a.id, { notes: notesValue });
                    addToast("success", t("toast.noteSaved"));
                    loadAccounts();
                  } catch {
                    addToast("error", t("toast.noteSaveError"));
                  }
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") {
                  setNotesValue(a.notes || "");
                  setEditingNotes(false);
                }
              }}
            />
          ) : (
            <span
              className="cursor-pointer text-gray-400 hover:text-gray-200 truncate block"
              onClick={() => {
                setNotesValue(a.notes || "");
                setEditingNotes(true);
              }}
              title={a.notes || t("tip.addNote")}
            >
              {a.notes || "—"}
            </span>
          )}
        </td>
      )}
      {/* Actions */}
      {cols.actions && (
        <td className="px-3 py-2 whitespace-nowrap">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => onValidate(a.id)}
              disabled={isProcessing}
              className="text-gray-400 hover:text-accent disabled:opacity-40"
              title={t("tip.validate")}
            >
              <IconPlay size={14} />
            </button>
            <button
              onClick={() => onEdit(a.id)}
              className="text-gray-400 hover:text-accent"
              title={t("tip.edit")}
            >
              <IconEdit size={14} />
            </button>
            <button
              onClick={() => onDelete(a.id)}
              className="text-gray-400 hover:text-red-400"
              title={t("tip.delete")}
            >
              <IconTrash size={14} />
            </button>
          </div>
        </td>
      )}
    </tr>
  );
}
