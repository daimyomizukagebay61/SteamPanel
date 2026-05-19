import { useState, useRef } from "react";
export function CountryBadge({ country }: { country: string | null }) {
  if (!country) return <span className="text-gray-600 text-xs">—</span>;
  const isCode = country.length === 2;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-gray-300 whitespace-nowrap">
      {isCode && (
        <span
          className={`fi fi-${country.toLowerCase()}`}
          style={{ width: "1.33em", height: "1em", borderRadius: "2px" }}
        />
      )}
      <span>{country}</span>
    </span>
  );
}
import { createPortal } from "react-dom";
import { IconLock, IconUnlock } from "@/components/shared/Icons";
import { t } from "@/lib/i18n";

interface Props {
  status: string;
}

const STATUS_KEYS: Record<string, [string, string]> = {
  unknown: ["badge-unknown", "status.unknown"],
  valid: ["badge-ok", "status.valid"],
  invalid: ["badge-error", "status.invalid"],
  locked: ["badge-error", "status.locked"],
  limited: ["badge-running", "status.limited"],
};

export function StatusBadge({ status }: Props) {
  const entry = STATUS_KEYS[status];
  const [cls, text] = entry ? [entry[0], t(entry[1])] : ["badge-unknown", status];
  return <span className={`badge ${cls}`}>{text}</span>;
}

export function BanBadge({ status }: { status: string | null }) {
  if (status === "BANNED") return <span className="badge badge-error">{t("status.banned")}</span>;
  if (status === "NO BAN") return <span className="badge badge-ok">{t("status.ok")}</span>;
  return <span className="badge badge-unknown">—</span>;
}

export function LockBadge({ status }: Props) {
  if (status === "locked") return <span className="badge badge-error"><IconLock size={12} /></span>;
  return <span className="badge badge-ok"><IconUnlock size={12} /></span>;
}

export function MafileBadge({ hasMafile }: { hasMafile: boolean }) {
  return hasMafile
    ? <span className="badge badge-ok">✓</span>
    : <span className="badge badge-unknown">—</span>;
}

export function VacBadge({ status, games }: { status: string | null; games?: string | null }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);

  const gameList: string[] = (() => {
    if (!games) return [];
    try { return JSON.parse(games) as string[]; } catch { return []; }
  })();

  const handleEnter = () => {
    if (!ref.current || gameList.length === 0) return;
    const r = ref.current.getBoundingClientRect();
    setPos({ top: r.top, left: r.right + 6 });
  };
  const handleLeave = () => setPos(null);

  if (status === "VAC") return <span className="badge badge-error">Vac</span>;

  if (status === "GAME BAN") {
    return (
      <>
        <span
          ref={ref}
          className="badge badge-error cursor-default"
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
        >
          Vac{gameList.length > 0 && <span className="ml-0.5 opacity-70">({gameList.length})</span>}
        </span>
        {pos && gameList.length > 0 && createPortal(
          <div
            style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 9999 }}
            className="bg-dark-700 border border-dark-600 rounded-lg shadow-xl px-2.5 py-2 min-w-[140px] max-w-[220px] pointer-events-none"
          >
            <div className="text-[10px] text-gray-400 mb-1 font-semibold uppercase tracking-wide">Game Bans</div>
            {gameList.map((g, i) => (
              <div key={i} className="text-xs text-gray-200 py-0.5 border-b border-dark-600 last:border-0">{g}</div>
            ))}
          </div>,
          document.body,
        )}
      </>
    );
  }

  if (status === "CLEAN") return <span className="badge badge-ok">NoVac</span>;
  return <span className="badge badge-unknown">—</span>;
}

export function LimitBadge({ status }: { status: string | null }) {
  if (status === "Lim") return <span className="badge badge-running">Lim</span>;
  if (status === "NoLim") return <span className="badge badge-ok">NoLim</span>;
  return <span className="badge badge-unknown">—</span>;
}
