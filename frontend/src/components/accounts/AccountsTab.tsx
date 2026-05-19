import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { api } from "@/api/client";
import { useAccountStore } from "@/stores/accountStore";
import { useUiStore } from "@/stores/uiStore";
import { useTaskStore } from "@/stores/taskStore";
import { useLogpassStore } from "@/stores/logpassStore";
import { useTokenStore } from "@/stores/tokenStore";
import { AccountTable } from "./AccountTable";
import { EditModal } from "./EditModal";
import { ImportModal } from "./ImportModal";
import { AddModal } from "./AddModal";
import { ConfirmModal } from "@/components/shared/Modals";
import { ColumnSettingsDropdown } from "./ColumnSettingsDropdown";
import {
  IconDownload,
  IconPlus,
  IconCheckCircle,
  IconXCircle,
  IconFolder,
  IconGlobe,
  IconRefresh,
  IconBan,
  IconPlay,
  IconLock,
  IconKey,
  IconZap,
} from "@/components/shared/Icons";
import { LogpassTab } from "./LogpassTab";
import { TokenTab } from "./TokenTab";
import type { AccountCreate, AccountUpdate, Task } from "@/api/types";
import { useT } from "@/lib/i18n";

type AccountSection = "mafile" | "logpass" | "token";

type AccResults = Record<string, { status: string; error?: string }>;

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

function parseIds(raw: Task["account_ids"]): number[] {
  if (!raw) return [];
  try {
    return JSON.parse(raw) as number[];
  } catch {
    return [];
  }
}

const BULK_ACTIONS = [
  { value: "", labelKey: "action.selectAction" },
  { value: "validate", labelKey: "action.validate" },
  { value: "change_password", labelKey: "action.changePassword" },
  { value: "random_password", labelKey: "action.randomPassword" },
  { value: "change_email", labelKey: "action.changeEmail" },
  { value: "remove_guard", labelKey: "action.removeGuard" },
  { value: "enable_auto_accept", labelKey: "action.enableAutoAccept" },
] as const;

function BulkActionDropdown({
  value,
  onChange,
  disabledActions,
}: {
  value: string;
  onChange: (v: string) => void;
  disabledActions?: Set<string>;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const label = t(
    BULK_ACTIONS.find((a) => a.value === value)?.labelKey ||
      "action.selectAction",
  );

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="bg-dark-700 border border-dark-600 rounded px-2 py-1.5 text-sm flex items-center gap-1 min-w-[170px] justify-between hover:border-dark-500 transition-colors"
      >
        <span className="truncate">{label}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path
            d="M3 4.5L6 7.5L9 4.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-dark-700 border border-dark-600 rounded shadow-lg min-w-[100px] py-1 max-h-[320px] overflow-y-auto">
          {BULK_ACTIONS.map((a) => {
            const disabled = !!(a.value && disabledActions?.has(a.value));
            return (
              <button
                key={a.value}
                type="button"
                onClick={() => {
                  if (!disabled) {
                    onChange(a.value);
                    setOpen(false);
                  }
                }}
                disabled={disabled}
                title={disabled ? t("action.noRevocationCode") : undefined}
                className={`w-full text-left px-3 py-2 text-sm transition-colors ${disabled ? "opacity-40 cursor-not-allowed" : "hover:bg-dark-600"} ${a.value === value ? "text-accent bg-dark-600/50" : ""} ${!a.value ? "text-gray-500" : ""}`}
              >
                {t(a.labelKey)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SectionAccountCount() {
  const section = useUiStore((s) => s.accountSection);
  const mafileCount = useAccountStore((s) => s.accounts.length);
  const logpassCount = useLogpassStore((s) => s.accounts.length);
  const tokenCount = useTokenStore((s) => s.accounts.length);
  const loadLogpass = useLogpassStore((s) => s.loadAccounts);
  const loadTokens = useTokenStore((s) => s.loadAccounts);
  const [displayCount, setDisplayCount] = useState(0);
  const rafRef = useRef<number>(0);
  const displayRef = useRef(0);
  const prevSection = useRef(section);

  useEffect(() => {
    if (section === "logpass" && logpassCount === 0) loadLogpass();
    if (section === "token" && tokenCount === 0) loadTokens();
  }, [section]);

  const count =
    section === "logpass"
      ? logpassCount
      : section === "token"
        ? tokenCount
        : mafileCount;

  useEffect(() => {
    cancelAnimationFrame(rafRef.current);

    const sectionChanged = prevSection.current !== section;
    prevSection.current = section;

    if (sectionChanged) {
      displayRef.current = count;
      setDisplayCount(count);
      return;
    }

    const start = displayRef.current;
    const diff = count - start;
    if (diff === 0) return;

    const duration = Math.min(400, Math.max(150, Math.abs(diff) * 2));
    const startTime = performance.now();

    const step = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const value = Math.max(0, Math.round(start + diff * eased));
      displayRef.current = value;
      setDisplayCount(value);
      if (progress < 1) rafRef.current = requestAnimationFrame(step);
    };

    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [count, section]);

  return (
    <div className="mt-1 px-3 py-2 border-t border-dark-600 flex items-center gap-2">
      <div className="relative shrink-0" style={{ width: 14, height: 14 }}>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-gray-400"
        >
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="icon-shimmer absolute inset-0"
          style={{ pointerEvents: "none" }}
        >
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      </div>
      <span className="text-sm text-gray-300 font-medium tabular-nums">
        {displayCount}
      </span>
    </div>
  );
}

export function AccountsTab() {
  const accounts = useAccountStore((s) => s.accounts);
  const selectedIds = useAccountStore((s) => s.selectedIds);
  const loadAccounts = useAccountStore((s) => s.loadAccounts);
  const clearSelection = useAccountStore((s) => s.clearSelection);
  const sendToMafileManager = useAccountStore((s) => s.sendToMafileManager);
  const setTab = useUiStore((s) => s.setTab);
  const addToast = useUiStore((s) => s.addToast);
  const autoProxyOnImport = useUiStore((s) => s.autoProxyOnImportMafile);
  const autoValidateOnImport = useUiStore((s) => s.autoValidateOnImportMafile);
  const loadTasks = useTaskStore((s) => s.loadTasks);
  const t = useT();

  const [editId, setEditId] = useState<number | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [confirmMsg, setConfirmMsg] = useState<string | null>(null);
  const [onConfirmAction, setOnConfirmAction] = useState<(() => void) | null>(
    null,
  );
  const [bulkAction, setBulkAction] = useState("");
  const section = useUiStore((s) => s.accountSection);
  const setSection = useUiStore((s) => s.setAccountSection);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [processingIds, setProcessingIds] = useState<Set<number>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [promptData, setPromptData] = useState<{
    taskId: string;
    message: string;
    login?: string;
  } | null>(null);
  const [promptValue, setPromptValue] = useState("");
  const [accountResults, setAccountResults] = useState<
    Record<string, { status: string; error?: string }>
  >({});
  const [accountSteps, setAccountSteps] = useState<
    Record<string, { step: number; total: number }>
  >({});

  const filteredAccounts = useMemo(() => {
    if (!searchQuery.trim()) return accounts;
    const q = searchQuery.trim();

    // lvl comparison syntax: lvl>10, lvl>=10, lvl<10, lvl<=10, lvl=10
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

    const ql = q.toLowerCase().trim();

    if (ql === "vac") return accounts.filter((a) => a.vac_status === "VAC" || a.vac_status === "GAME BAN");
    if (ql === "gameban" || ql === "game ban") return accounts.filter((a) => a.vac_status === "GAME BAN");
    if (ql === "clean") return accounts.filter((a) => a.vac_status === "CLEAN");
    if (ql === "lim") return accounts.filter((a) => a.limit_status === "Lim");
    if (ql === "nolim") return accounts.filter((a) => a.limit_status === "NoLim");
    if (ql === "ban" || ql === "banned") return accounts.filter((a) => a.ban_status === "BANNED");
    if (ql === "noban" || ql === "no ban") return accounts.filter((a) => a.ban_status === "NO BAN");

    // Country filter: "country:us" or "country:united states"
    const countryMatch = ql.match(/^country:(.+)$/);
    if (countryMatch) {
      const cv = countryMatch[1].trim().toLowerCase();
      return accounts.filter((a) => a.country?.toLowerCase().includes(cv));
    }

    // Balance filter: "balance>10", "usd>10", "balance<5", etc.
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

    const words = ql.split(/\s+/).filter(Boolean);
    return accounts.filter((a) => {
      if (a.login.toLowerCase().includes(ql)) return true;
      if (a.steam_id && a.steam_id.toLowerCase().includes(ql)) return true;
      if (a.country && a.country.toLowerCase().includes(ql)) return true;
      if (a.notes) {
        const notesLower = a.notes.toLowerCase();
        return words.some((w) => notesLower.includes(w));
      }
      return false;
    });
  }, [accounts, searchQuery]);

  const bulkDisabledActions = useMemo(() => {
    const disabled = new Set<string>();
    const selected = accounts.filter((a) => selectedIds.has(a.id));
    if (!selected.some((a) => a.has_revocation_code)) {
      disabled.add("remove_guard");
    }
    return disabled;
  }, [accounts, selectedIds]);

  useEffect(() => {
    loadAccounts();
  }, []);

  const confirm = (msg: string, action: () => void) => {
    setConfirmMsg(msg);
    setOnConfirmAction(() => action);
  };

  const watchTask = useCallback(
    (taskId: string, accountIds: number[] = [], clearResults = true) => {
      if (clearResults) {
        setAccountResults((prev) => {
          const next = { ...prev };
          accountIds.forEach((id) => delete next[String(id)]);
          return next;
        });
      }
      const es = new EventSource(`/api/tasks/${taskId}/stream`);
      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data) as Task;
          setActiveTask(data);
          const parsed = parseAccResults(data.account_results);
          if (parsed) {
            setAccountResults((prev) => ({ ...prev, ...parsed }));
          }
          if (data.account_steps) {
            setAccountSteps((prev) => ({ ...prev, ...data.account_steps }));
          }
          if (data.prompt) {
            setPromptData({
              taskId,
              message: data.prompt,
              login: data.prompt_login,
            });
            setPromptValue("");
          }
          if (
            data.status === "completed" ||
            data.status === "failed" ||
            data.status === "cancelled"
          ) {
            if (data.status === "completed") {
              addToast(
                "success",
                `${data.type}: ${data.result || t("toast.done")}`,
              );
            } else if (data.status === "cancelled") {
              addToast("info", t("toast.taskCancelled"));
            } else {
              addToast(
                "error",
                `${data.type}: ${data.error || t("toast.error")}`,
              );
            }
            setProcessingIds((prev) => {
              const s = new Set(prev);
              accountIds.forEach((id) => s.delete(id));
              return s;
            });
            setPromptData(null);
            loadAccounts();
            loadTasks();
            es.close();
            setTimeout(() => setActiveTask(null), 3000);
          }
        } catch {
          /* ignore */
        }
      };
      es.onerror = () => es.close();
    },
    [addToast, loadAccounts, loadTasks],
  );

  // Restore running/completed task state on page load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const tasks = await api.getTasks();
        if (cancelled) return;

        const running = tasks.find((t) => t.status === "running");
        if (running) {
          const ids = parseIds(running.account_ids);
          setActiveTask(running);
          setProcessingIds(new Set(ids));
          const restored = parseAccResults(running.account_results);
          if (restored) setAccountResults(restored);
          watchTask(running.id, ids, false);
          return;
        }

        const recent = tasks.find(
          (t) => t.status === "completed" || t.status === "failed",
        );
        if (recent) {
          const restored = parseAccResults(recent.account_results);
          if (restored && Object.keys(restored).length > 0) {
            setAccountResults(restored);
          }
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [watchTask]);

  const handleAction = async (
    id: number,
    action: string,
    params: Record<string, string>,
  ) => {
    const acc = accounts.find((a) => a.id === id);
    const login = acc?.login ?? `#${id}`;
    try {
      setProcessingIds((prev) => new Set(prev).add(id));
      const result = await api.executeAction({
        account_ids: [id],
        action,
        params,
      });
      addToast(
        "info",
        t("misc.taskAction", { id: result.task_id, action, login }),
      );
      watchTask(result.task_id, [id]);
    } catch (e: unknown) {
      setProcessingIds((prev) => {
        const s = new Set(prev);
        s.delete(id);
        return s;
      });
      addToast(
        "error",
        t("misc.error", { error: e instanceof Error ? e.message : String(e) }),
      );
    }
  };

  const handlePromptSubmit = async () => {
    if (!promptData || !promptValue) return;
    try {
      await api.respondToPrompt(
        promptData.taskId,
        promptValue,
        promptData.login,
      );
      setPromptData(null);
    } catch (e: unknown) {
      addToast(
        "error",
        t("misc.error", { error: e instanceof Error ? e.message : String(e) }),
      );
    }
  };

  const handlePromptCancel = async () => {
    if (promptData) {
      try {
        await api.cancelTask(promptData.taskId);
      } catch {
        /* task may already be done */
      }
    }
    setPromptData(null);
  };

  const handleBulkAction = () => {
    if (!bulkAction) return addToast("warn", t("toast.selectAction"));
    if (!selectedIds.size) return addToast("warn", t("toast.selectAccounts"));

    if (bulkAction === "enable_auto_accept") {
      const ids = [...selectedIds];
      clearSelection();
      api
        .startAutoAccept(ids)
        .then(() => {
          addToast(
            "success",
            t("toast.autoAcceptEnabled", { count: ids.length }),
          );
          loadAccounts();
        })
        .catch((e: unknown) =>
          addToast(
            "error",
            t("misc.error", {
              error: e instanceof Error ? e.message : String(e),
            }),
          ),
        );
      return;
    }

    const capturedIds = [...selectedIds];
    const capturedAction = bulkAction;
    const actionLabel = t(
      BULK_ACTIONS.find((a) => a.value === capturedAction)?.labelKey ||
        "action.selectAction",
    );
    confirm(
      t("confirm.executeBulk", {
        action: actionLabel,
        count: capturedIds.length,
      }),
      async () => {
        try {
          const result = await api.executeAction({
            account_ids: capturedIds,
            action: capturedAction,
          });
          clearSelection();
          setProcessingIds((prev) => {
            const s = new Set(prev);
            capturedIds.forEach((id) => s.add(id));
            return s;
          });
          addToast(
            "info",
            t("misc.taskCount", {
              id: result.task_id,
              count: result.accounts_count,
            }),
          );
          watchTask(result.task_id, capturedIds);
        } catch (e: unknown) {
          addToast(
            "error",
            t("misc.error", {
              error: e instanceof Error ? e.message : String(e),
            }),
          );
        }
      },
    );
  };

  const handleToggleAutoAccept = async (id: number) => {
    const acc = accounts.find((a) => a.id === id);
    if (!acc) return;
    const enable = !acc.auto_accept;
    try {
      if (enable) await api.startAutoAccept([id]);
      else await api.stopAutoAccept([id]);
      addToast(
        "info",
        enable ? t("toast.autoAcceptOn") : t("toast.autoAcceptOff"),
      );
      await loadAccounts();
    } catch (e: unknown) {
      addToast(
        "error",
        t("misc.error", { error: e instanceof Error ? e.message : String(e) }),
      );
    }
  };

  const handleToggleAutoConfirm = async (id: number) => {
    const acc = accounts.find((a) => a.id === id);
    if (!acc) return;
    const enable = !acc.auto_confirm;
    try {
      if (enable) await api.startAutoConfirm([id]);
      else await api.stopAutoConfirm([id]);
      addToast(
        "info",
        enable ? t("action.enableAutoConfirm") : t("action.disableAutoConfirm"),
      );
      await loadAccounts();
    } catch (e: unknown) {
      addToast(
        "error",
        t("misc.error", { error: e instanceof Error ? e.message : String(e) }),
      );
    }
  };

  const handleEdit = (id: number) => setEditId(id);

  const handleSaveEdit = async (id: number, data: AccountUpdate) => {
    try {
      await api.updateAccount(id, data);
      setEditId(null);
      addToast("success", t("toast.saved"));
      await loadAccounts();
    } catch (e: unknown) {
      addToast(
        "error",
        t("misc.error", { error: e instanceof Error ? e.message : String(e) }),
      );
    }
  };

  const handleDelete = (id: number) => {
    confirm(t("confirm.deleteAccount"), async () => {
      try {
        await api.deleteAccount(id);
        addToast("success", t("toast.accountDeleted"));
        await loadAccounts();
      } catch (e: unknown) {
        addToast(
          "error",
          t("misc.error", {
            error: e instanceof Error ? e.message : String(e),
          }),
        );
      }
    });
  };

  const handleDeleteSelected = () => {
    if (!selectedIds.size) return addToast("warn", t("toast.selectAccounts"));
    confirm(
      t("confirm.deleteSelected", { count: selectedIds.size }),
      async () => {
        try {
          const result = await api.deleteBulk([...selectedIds]);
          clearSelection();
          addToast("success", t("toast.deleted", { count: result.deleted }));
          await loadAccounts();
        } catch (e: unknown) {
          addToast(
            "error",
            t("misc.error", {
              error: e instanceof Error ? e.message : String(e),
            }),
          );
        }
      },
    );
  };

  const handleDeleteAll = () => {
    if (!accounts.length) return addToast("warn", t("toast.noAccounts"));
    confirm(t("confirm.deleteAll", { count: accounts.length }), async () => {
      try {
        const result = await api.deleteBulk([]);
        clearSelection();
        addToast("success", t("toast.deleted", { count: result.deleted }));
        await loadAccounts();
      } catch (e: unknown) {
        addToast(
          "error",
          t("misc.error", {
            error: e instanceof Error ? e.message : String(e),
          }),
        );
      }
    });
  };

  const handleAddAccount = async (data: AccountCreate) => {
    try {
      await api.createAccount(data);
      setShowAdd(false);
      addToast("success", t("toast.accountAdded"));
      await loadAccounts();
    } catch (e: unknown) {
      addToast(
        "error",
        t("misc.error", { error: e instanceof Error ? e.message : String(e) }),
      );
    }
  };

  const handleSendToMafiles = () => {
    if (!selectedIds.size) return addToast("warn", t("toast.selectAccounts"));
    sendToMafileManager([...selectedIds]);
    setTab("mafiles");
    addToast("info", t("toast.sentToMafile", { count: selectedIds.size }));
  };

  const handleOpenBrowser = async (id: number) => {
    try {
      const result = await api.openBrowser(id);
      if (result.status === "revalidating") {
        addToast("warn", t("toast.cookiesExpiredRevalidating"));
        if (result.task_id) {
          setProcessingIds((prev) => new Set(prev).add(id));
          watchTask(result.task_id, [id]);
        }
      } else {
        addToast("info", t("toast.browserOpening"));
      }
    } catch (e: unknown) {
      addToast(
        "error",
        t("misc.error", { error: e instanceof Error ? e.message : String(e) }),
      );
    }
  };

  const handleAssignProxies = async () => {
    confirm(t("confirm.assignProxies"), async () => {
      try {
        const r = await api.assignProxies();
        addToast(
          "success",
          t("toast.proxiesAssigned", {
            used: r.proxies_used,
            count: r.assigned,
          }),
        );
        await loadAccounts();
      } catch (e: unknown) {
        addToast(
          "error",
          t("misc.error", {
            error: e instanceof Error ? e.message : String(e),
          }),
        );
      }
    });
  };

  const handleReassignProxies = async () => {
    confirm(t("confirm.reassignProxies"), async () => {
      try {
        const r = await api.reassignProxies();
        addToast(
          "success",
          t("toast.proxiesReassigned", {
            used: r.proxies_used,
            count: r.assigned,
          }),
        );
        await loadAccounts();
      } catch (e: unknown) {
        addToast(
          "error",
          t("misc.error", {
            error: e instanceof Error ? e.message : String(e),
          }),
        );
      }
    });
  };

  const handleClearProxies = async () => {
    confirm(t("confirm.clearProxies"), async () => {
      try {
        const r = await api.clearProxies();
        addToast(
          "success",
          t("toast.proxiesClearedCount", { count: r.cleared }),
        );
        await loadAccounts();
      } catch (e: unknown) {
        addToast(
          "error",
          t("misc.error", {
            error: e instanceof Error ? e.message : String(e),
          }),
        );
      }
    });
  };

  const handleAfterImport = useCallback(
    async (newIds: number[]) => {
      let proxyOn = autoProxyOnImport;
      let validateOn = autoValidateOnImport;
      try {
        const fresh = await api.getValidationSettings();
        proxyOn = fresh.auto_proxy_on_import_mafile;
        validateOn = fresh.auto_validate_on_import_mafile;
      } catch {
        /* fall back to stale store values */
      }

      if (proxyOn) {
        try {
          const r = await api.assignProxies();
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
          setProcessingIds(new Set(newIds));
          const result = await api.executeAction({
            account_ids: newIds,
            action: "validate",
          });
          setActiveTask({
            id: result.task_id,
            type: "validate",
            status: "running",
            progress: 0,
            total: newIds.length,
            result: null,
            error: null,
            account_ids: null,
            account_results: null,
            created_at: "",
            updated_at: "",
          });
          watchTask(result.task_id, newIds);
        } catch (e: unknown) {
          setProcessingIds(new Set());
          addToast(
            "error",
            t("misc.error", {
              error: e instanceof Error ? e.message : String(e),
            }),
          );
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

  const editAccount = editId ? accounts.find((a) => a.id === editId) : null;

  const SECTIONS: {
    id: AccountSection;
    label: string;
    icon: React.ReactNode;
  }[] = [
    { id: "mafile", label: "Mafile", icon: <IconLock size={14} /> },
    { id: "logpass", label: "Log:Pass", icon: <IconKey size={14} /> },
    { id: "token", label: "Token", icon: <IconZap size={14} /> },
  ];

  return (
    <div className="flex gap-3 h-full min-h-0 overflow-hidden">
      {/* Section sidebar */}
      <div className="w-36 shrink-0 flex flex-col gap-1 bg-dark-800 border border-dark-600 rounded-lg p-2 self-start">
        <p className="text-xs font-medium text-gray-500 px-2 py-1 uppercase tracking-wider">
          {t("section.dataType")}
        </p>
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => setSection(s.id)}
            className={`flex items-center gap-2 px-3 py-2 rounded text-sm text-left w-full transition-colors ${
              section === s.id
                ? "bg-accent/20 text-accent"
                : "text-gray-400 hover:text-gray-200 hover:bg-dark-700"
            }`}
          >
            {s.icon}
            {s.label}
          </button>
        ))}
        <SectionAccountCount />
      </div>

      {section === "logpass" && (
        <div className="flex-1 min-w-0 min-h-0">
          <LogpassTab />
        </div>
      )}
      {section === "token" && (
        <div className="flex-1 min-w-0 min-h-0">
          <TokenTab />
        </div>
      )}
      {section === "mafile" && (
        <div className="flex flex-col gap-4 flex-1 min-w-0 min-h-0 overflow-hidden">
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

            {/* Inline progress indicator */}
            {activeTask && (
              <>
                <div className="h-5 border-l border-dark-500" />
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs text-gray-400 whitespace-nowrap">
                    {activeTask.type === "validate"
                      ? t("task.validate")
                      : activeTask.type === "change_password"
                        ? t("task.changePassword")
                        : activeTask.type === "random_password"
                          ? t("task.randomPassword")
                          : activeTask.type === "change_email"
                            ? t("task.changeEmail")
                            : activeTask.type === "change_phone"
                              ? t("task.changePhone")
                              : activeTask.type === "remove_guard"
                                ? t("task.removeGuard")
                                : activeTask.type}
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
                                  (activeTask.progress / activeTask.total) *
                                    100,
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
              <ColumnSettingsDropdown />
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
            {/* Action bar (table header panel) */}
            <div className="px-3 py-2 flex items-center gap-2 border-b border-dark-600 shrink-0 bg-dark-800">
              <BulkActionDropdown
                value={bulkAction}
                onChange={setBulkAction}
                disabledActions={bulkDisabledActions}
              />
              <button
                onClick={handleBulkAction}
                disabled={!!activeTask || processingIds.size > 0}
                className="btn-accent text-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <IconPlay size={12} className="inline mr-1" />
                {t("btn.execute")}
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
                onClick={handleSendToMafiles}
                className="btn-secondary text-sm"
              >
                <IconFolder size={14} className="inline mr-1" />В Mafile Manager
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
              <AccountTable
                accounts={filteredAccounts}
                processingIds={processingIds}
                accountResults={accountResults}
                accountSteps={accountSteps}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onAction={handleAction}
                onToggleAutoAccept={handleToggleAutoAccept}
                onToggleAutoConfirm={handleToggleAutoConfirm}
                onOpenBrowser={handleOpenBrowser}
              />
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      {editAccount && (
        <EditModal
          account={editAccount}
          onSave={handleSaveEdit}
          onClose={() => setEditId(null)}
        />
      )}
      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onImportDone={handleAfterImport}
        />
      )}
      {showAdd && (
        <AddModal onSave={handleAddAccount} onClose={() => setShowAdd(false)} />
      )}
      {confirmMsg && onConfirmAction && (
        <ConfirmModal
          message={confirmMsg}
          onConfirm={() => {
            onConfirmAction();
            setConfirmMsg(null);
            setOnConfirmAction(null);
          }}
          onCancel={() => {
            setConfirmMsg(null);
            setOnConfirmAction(null);
          }}
        />
      )}
      {promptData && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
          onMouseDown={handlePromptCancel}
        >
          <div
            className="bg-dark-800 border border-dark-600 rounded-lg p-5 w-96 shadow-xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <p className="text-sm text-gray-300 mb-3">{promptData.message}</p>
            <input
              autoFocus
              value={promptValue}
              onChange={(e) => setPromptValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handlePromptSubmit()}
              className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm mb-3"
              placeholder={t("prompt.enterValue")}
            />
            <div className="flex gap-2">
              <button
                onClick={handlePromptSubmit}
                className="btn-primary flex-1"
              >
                OK
              </button>
              <button
                onClick={handlePromptCancel}
                className="btn-secondary flex-1"
              >
                {t("btn.cancel")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
