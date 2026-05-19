import { useEffect, useMemo, useRef, useState } from "react";
import type { Account, ColumnSettings } from "@/api/types";
import { useAccountStore } from "@/stores/accountStore";
import { useUiStore } from "@/stores/uiStore";
import { AccountRow } from "./AccountRow";
import { useT } from "@/lib/i18n";

const COLUMN_KEYS: (keyof ColumnSettings)[] = [
  "browser",
  "profile",
  "last_online",
  "steam_id",
  "login",
  "password",
  "login_pass",
  "email",
  "email_pass",
  "email_login_pass",
  "phone",
  "status",
  "ban",
  "vac",
  "limit",
  "balance",
  "country",
  "twofa",
  "mafile",
  "proxy",
  "notes",
  "actions",
];

const COL_LABEL_KEYS: Record<keyof ColumnSettings, string> = {
  browser: "col.browser",
  profile: "col.profile",
  last_online: "col.lastOnline",
  steam_id: "col.steamId",
  login: "col.login",
  password: "col.password",
  login_pass: "col.loginPass",
  email: "col.email",
  email_pass: "col.emailPass",
  email_login_pass: "col.emailLoginPass",
  phone: "col.phone",
  status: "col.status",
  ban: "col.ban",
  vac: "col.vac",
  limit: "col.limit",
  balance: "col.balance",
  country: "col.country",
  twofa: "col.twofa",
  mafile: "col.mafile",
  proxy: "col.proxy",
  notes: "col.notes",
  actions: "col.actions",
};

interface Props {
  accounts: Account[];
  processingIds: Set<number>;
  accountResults: Record<string, { status: string; error?: string }>;
  accountSteps: Record<string, { step: number; total: number }>;
  onEdit: (id: number) => void;
  onDelete: (id: number) => void;
  onAction: (
    id: number,
    action: string,
    params: Record<string, string>,
  ) => void;
  onToggleAutoAccept: (id: number) => void;
  onToggleAutoConfirm: (id: number) => void;
  onOpenBrowser: (id: number) => void;
}

export function AccountTable({
  accounts,
  processingIds,
  accountResults,
  accountSteps,
  onEdit,
  onDelete,
  onAction,
  onToggleAutoAccept,
  onToggleAutoConfirm,
  onOpenBrowser,
}: Props) {
  const selectedIds = useAccountStore((s) => s.selectedIds);
  const setSelectedIds = useAccountStore((s) => s.setSelectedIds);
  const cols = useUiStore((s) => s.columnVisibility);
  const t = useT();

  const allFilteredSelected =
    accounts.length > 0 && accounts.every((a) => selectedIds.has(a.id));

  const toggleSelectAllFiltered = () => {
    if (allFilteredSelected) {
      // Deselect only the filtered accounts, keep others selected
      const next = new Set(selectedIds);
      accounts.forEach((a) => next.delete(a.id));
      setSelectedIds(next);
    } else {
      // Add all filtered accounts to selection
      const next = new Set(selectedIds);
      accounts.forEach((a) => next.add(a.id));
      setSelectedIds(next);
    }
  };
  const visibleKeys = COLUMN_KEYS.filter((k) => cols[k]);

  const BATCH = 100;
  const [visibleCount, setVisibleCount] = useState(BATCH);
  const sentinelRef = useRef<HTMLTableRowElement>(null);

  type SortField = "last_online" | "ban" | "vac" | "limit" | null;
  type SortDir = "asc" | "desc";
  const [sortField, setSortField] = useState<SortField>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      if (sortDir === "asc") setSortDir("desc");
      else { setSortField(null); setSortDir("asc"); }
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const STATUS_ORDER: Record<string, number> = {
    BANNED: 0, "GAME BAN": 0, VAC: 1, Lim: 0, NoLim: 1,
    "NO BAN": 2, CLEAN: 2,
  };

  const sorted = useMemo(() => {
    if (!sortField) return accounts;
    const dir = sortDir === "asc" ? 1 : -1;
    const EMPTY = 999;
    return [...accounts].sort((a, b) => {
      let va: number, vb: number;
      if (sortField === "last_online") {
        const parse = (v: string | null | undefined): number => {
          if (!v || v === "\u2014") return EMPTY;
          if (v === "online") return -1;
          const m = v.match(/^(\d+)([mhd])$/i);
          if (!m) return EMPTY;
          const n = parseInt(m[1], 10);
          if (m[2] === "m") return n;
          if (m[2] === "h") return n * 60;
          return n * 1440;
        };
        va = parse(a.last_online); vb = parse(b.last_online);
      } else if (sortField === "ban") {
        va = STATUS_ORDER[a.ban_status ?? ""] ?? EMPTY;
        vb = STATUS_ORDER[b.ban_status ?? ""] ?? EMPTY;
      } else if (sortField === "vac") {
        va = STATUS_ORDER[a.vac_status ?? ""] ?? EMPTY;
        vb = STATUS_ORDER[b.vac_status ?? ""] ?? EMPTY;
      } else {
        va = STATUS_ORDER[a.limit_status ?? ""] ?? EMPTY;
        vb = STATUS_ORDER[b.limit_status ?? ""] ?? EMPTY;
      }
      if (va === vb) return 0;
      if (va === EMPTY) return 1;
      if (vb === EMPTY) return -1;
      return (va < vb ? -1 : 1) * dir;
    });
  }, [accounts, sortField, sortDir]);

  useEffect(() => {
    setVisibleCount(BATCH);
  }, [accounts, sortField, sortDir]);


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

  // Build proxy labels: unique proxies get numbered "Прокси 1", "Прокси 2", etc.
  const proxyLabels = useMemo(() => {
    const map = new Map<number, string>();
    const uniqueProxies: string[] = [];
    for (const a of accounts) {
      if (a.proxy && !uniqueProxies.includes(a.proxy)) {
        uniqueProxies.push(a.proxy);
      }
    }
    const proxyToNum = new Map<string, number>();
    uniqueProxies.forEach((p, i) => proxyToNum.set(p, i + 1));
    for (const a of accounts) {
      if (a.proxy) {
        const num = proxyToNum.get(a.proxy);
        map.set(a.id, num ? t("proxy.label", { num }) : a.proxy);
      }
    }
    return map;
  }, [accounts]);

  if (!accounts.length) {
    return (
      <div className="text-center text-gray-500 py-8">
        {t("empty.accounts")}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
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
            <th className="w-5"></th>
            {visibleKeys.map((k) => {
              const sortKey = (k === "ban" || k === "vac" || k === "limit" || k === "last_online")
                ? k as SortField
                : null;
              if (sortKey) {
                return (
                  <th
                    key={k}
                    className="px-3 py-2 cursor-pointer select-none hover:text-gray-300"
                    onClick={() => toggleSort(sortKey)}
                  >
                    {t(COL_LABEL_KEYS[k])}
                    {sortField === sortKey ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                  </th>
                );
              }
              return (
                <th
                  key={k}
                  className={`px-3 py-2${k === "browser" ? " text-center" : ""}`}
                >
                  {t(COL_LABEL_KEYS[k])}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {visible.map((a) => (
            <AccountRow
              key={a.id}
              account={a}
              visibleColumns={cols}
              proxyLabel={proxyLabels.get(a.id) ?? null}
              isProcessing={processingIds.has(a.id)}
              accountResult={accountResults[String(a.id)]}
              accountStep={accountSteps[String(a.id)]}
              onEdit={onEdit}
              onDelete={onDelete}
              onAction={onAction}
              onToggleAutoAccept={onToggleAutoAccept}
              onToggleAutoConfirm={onToggleAutoConfirm}
              onOpenBrowser={onOpenBrowser}
            />
          ))}
          {visibleCount < accounts.length && (
            <tr ref={sentinelRef}>
              <td
                colSpan={visibleKeys.length + 2}
                className="text-center py-3 text-xs text-gray-500"
              >
                {t("paging.shown", {
                  visible: visibleCount,
                  total: accounts.length,
                })}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
