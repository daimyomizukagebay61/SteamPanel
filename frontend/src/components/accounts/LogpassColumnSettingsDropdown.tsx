import { useState, useRef, useEffect } from "react";
import { useUiStore } from "@/stores/uiStore";
import type { LogpassColumnSettings } from "@/api/types";
import { IconSettings } from "@/components/shared/Icons";
import { useT } from "@/lib/i18n";

const COL_LABEL_KEYS: Record<keyof LogpassColumnSettings, string> = {
  browser: "col.browser", profile: "col.profile", last_online: "col.lastOnline",
  steam_id: "col.steamId", login: "col.login", password: "col.password",
  login_pass: "col.loginPass", status: "col.status", ban: "col.ban",
  vac: "col.vac", limit: "col.limit",
  balance: "col.balance", country: "col.country",
  prime: "col.prime", trophy: "col.trophy", behavior: "col.behavior",
  license: "col.license", proxy: "col.proxy", notes: "col.notes", actions: "col.actions",
};

export function LogpassColumnSettingsDropdown() {
  const [open, setOpen] = useState(false);
  const cols = useUiStore((s) => s.logpassColumnVisibility);
  const toggleColumn = useUiStore((s) => s.toggleLogpassColumn);
  const ref = useRef<HTMLDivElement>(null);
  const t = useT();

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="btn-secondary text-sm px-2 py-2"
        title={t("tip.columnSettings")}
      >
        <IconSettings size={14} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-dark-700 border border-dark-600 rounded-lg shadow-xl z-50 p-2 min-w-[160px]">
          {(Object.keys(COL_LABEL_KEYS) as (keyof LogpassColumnSettings)[]).map((key) => (
            <label
              key={key}
              className="flex items-center gap-2 px-2 py-1 hover:bg-dark-600 rounded cursor-pointer text-sm"
            >
              <input
                type="checkbox"
                checked={cols[key]}
                onChange={() => toggleColumn(key)}
              />
              {t(COL_LABEL_KEYS[key])}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
