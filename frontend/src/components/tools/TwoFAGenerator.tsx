import { useState, useEffect, useRef } from "react";
import { api } from "@/api/client";
import { useUiStore } from "@/stores/uiStore";
import { useAccountStore } from "@/stores/accountStore";
import { copyText } from "@/lib/clipboard";
import { useT } from "@/lib/i18n";
import { IconKey } from "@/components/shared/Icons";
import type { Account } from "@/api/types";

type Mode = "secret" | "account";

export function TwoFAGenerator() {
  const t = useT();
  const [mode, setMode] = useState<Mode>("secret");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Account | null>(null);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const addToast = useUiStore((s) => s.addToast);
  const accounts = useAccountStore((s) => s.accounts);
  const loadAccounts = useAccountStore((s) => s.loadAccounts);

  useEffect(() => {
    if (mode === "account" && accounts.length === 0) loadAccounts();
  }, [mode]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const filtered = accounts
    .filter((a) => {
      const q = search.toLowerCase();
      return !q || a.login.toLowerCase().includes(q) || (a.steam_id ?? "").includes(q);
    })
    .slice(0, 12);

  const generate = async () => {
    try {
      if (mode === "secret") {
        if (!secret.trim()) return;
        const data = await api.generate2FA(secret.trim());
        setCode(data.code);
      } else {
        if (!selected) return;
        const data = await api.generate2FAByAccount(selected.id);
        setCode(data.code);
      }
    } catch (e: unknown) {
      setCode(t("tools.genErrorStr"));
      addToast("error", t("misc.genError", { error: e instanceof Error ? e.message : String(e) }));
    }
  };

  const handleCopy = async () => {
    if (!code || code === t("tools.genErrorStr")) return;
    const ok = await copyText(code);
    addToast(ok ? "success" : "error", ok ? t("toast.copied") : t("toast.copyFailed"));
  };

  const tabCls = (m: Mode) =>
    `flex-1 py-1.5 text-xs font-medium rounded transition-colors ${
      mode === m ? "bg-dark-600 text-gray-100" : "text-gray-500 hover:text-gray-300"
    }`;

  return (
    <div className="bg-dark-800 border border-dark-600 rounded-xl overflow-hidden flex flex-col">
      <div className="px-4 py-3 border-b border-dark-600 flex items-center gap-2">
        <IconKey size={14} className="text-accent shrink-0" />
        <span className="text-sm font-semibold text-gray-100">{t("tools.2faGenerator")}</span>
      </div>

      <div className="px-4 pt-3 pb-2">
        <div className="flex gap-1 bg-dark-900 rounded p-0.5 mb-3">
          <button type="button" className={tabCls("secret")} onClick={() => setMode("secret")}>Shared secret</button>
          <button type="button" className={tabCls("account")} onClick={() => setMode("account")}>Из Mafile</button>
        </div>

        {mode === "secret" ? (
          <div className="flex gap-2">
            <input
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && generate()}
              placeholder="shared_secret"
              className="flex-1 bg-dark-700 border border-dark-600 rounded px-3 py-1.5 text-sm"
            />
            <button type="button" onClick={generate} className="btn-primary text-sm px-3 py-1.5">{t("btn.generate")}</button>
          </div>
        ) : (
          <div className="flex gap-2">
            <div className="relative flex-1" ref={dropdownRef}>
              <input
                value={selected ? `${selected.login}${selected.steam_id ? " · " + selected.steam_id : ""}` : search}
                onChange={(e) => { setSearch(e.target.value); setSelected(null); setOpen(true); }}
                onFocus={() => setOpen(true)}
                placeholder="Логин или SteamID..."
                className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-1.5 text-sm"
              />
              {open && filtered.length > 0 && (
                <div className="absolute top-full mt-1 left-0 right-0 bg-dark-800 border border-dark-600 rounded-lg shadow-xl z-50 max-h-48 overflow-y-auto">
                  {filtered.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      className="w-full text-left px-3 py-1.5 text-sm hover:bg-dark-600 transition-colors flex items-center justify-between gap-2"
                      onMouseDown={() => { setSelected(a); setSearch(""); setOpen(false); }}
                    >
                      <span className="text-gray-200 truncate">{a.login}</span>
                      {a.steam_id && <span className="text-gray-500 text-xs shrink-0">{a.steam_id}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button type="button" onClick={generate} disabled={!selected} className="btn-primary text-sm px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed">{t("btn.generate")}</button>
          </div>
        )}

        {code && (
          <div
            className="mt-3 text-2xl font-mono text-accent cursor-pointer tabular-nums tracking-widest"
            onClick={handleCopy}
            title={t("tools.clickCopy")}
          >
            {code}
          </div>
        )}
      </div>
    </div>
  );
}
