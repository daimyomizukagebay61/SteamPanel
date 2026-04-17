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
