import { useEffect, useState } from "react";
import { api } from "@/api/client";
import type { TokenAccount, TokenCheckData } from "@/api/types";
import { copyText } from "@/lib/clipboard";
import { IconX, IconRefresh, IconLoader } from "@/components/shared/Icons";

interface Props {
  account: TokenAccount;
  onClose: () => void;
  onRecheck: () => void;
}

function Row({
  label,
  value,
  good,
  bad,
}: {
  label: string;
  value: string;
  good?: boolean;
  bad?: boolean;
}) {
  return (
    <div className="flex text-[11px] font-mono leading-[1.7]">
      <span className="w-27.5 shrink-0 text-gray-500">{label}</span>
      <span
        className={`min-w-0 wrap-break-word ${
          good ? "text-green-400" : bad ? "text-red-400" : "text-gray-200"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dark-600 bg-dark-900/40 px-3 py-2 space-y-0">
      <div className="text-[9px] font-semibold uppercase tracking-widest text-gray-600 pt-1 pb-0.5">
        {title}
      </div>
      {children}
    </div>
  );
}

function fmtPlaytime(minutes: number): string {
  if (minutes <= 0) return "0ч";
  const h = (minutes / 60).toFixed(1);
  return `${h}ч`;
}

function fmtCheckedAt(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function TokenCheckModal({ account, onClose, onRecheck }: Props) {
  const [data, setData] = useState<TokenCheckData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getTokenCheckData(account.id)
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setLoading(false);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [account.id]);

  const handleCopySteamId = () => {
    if (data?.steam_id) copyText(data.steam_id);
  };

  // Close on backdrop click
  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onClick={handleBackdrop}
    >
      <div className="bg-dark-800 border border-dark-600 rounded-xl w-full max-w-160 max-h-[85vh] flex flex-col shadow-2xl mx-4">
        {/* Header */}
        <div className="px-5 pt-4 pb-3 border-b border-dark-600 flex items-start justify-between shrink-0">
          <div className="flex items-start gap-3 min-w-0">
            {/* Avatar */}
            <div className="h-9 w-9 rounded-lg bg-dark-700 shrink-0 overflow-hidden">
              {(data?.avatar_url ?? account.avatar_url) ? (
                <img
                  src={(data?.avatar_url ?? account.avatar_url)!}
                  alt=""
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-dark-600" />
              )}
            </div>

            {/* Name + meta */}
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-gray-100 truncate">
                  {data?.display_name ??
                    account.nickname ??
                    account.login ??
                    "—"}
                </span>
                {(data?.steam_level ?? account.steam_level) != null && (
                  <span className="rounded bg-accent/15 border border-accent/30 px-1.5 py-0.5 text-[9px] font-bold text-accent">
                    Lv.{data?.steam_level ?? account.steam_level}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-0.5 text-[10px] text-gray-500 flex-wrap">
                {(data?.steam_id ?? account.steam_id) && (
                  <button
                    onClick={handleCopySteamId}
                    className="font-mono hover:text-gray-300 transition"
                    title="Копировать SteamID"
                  >
                    {data?.steam_id ?? account.steam_id}
                  </button>
                )}
                {(data?.last_online ?? account.last_online) && (
                  <>
                    <span className="text-gray-700">·</span>
                    <span>{data?.last_online ?? account.last_online}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 shrink-0 ml-3">
            <button
              onClick={onRecheck}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg bg-accent/10 border border-accent/30 text-accent hover:bg-accent/20 transition"
              title="Запустить полную проверку"
            >
              <IconRefresh size={12} />
              Обновить
            </button>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-300 transition p-1 rounded"
              title="Закрыть"
            >
              <IconX size={16} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto min-h-0 px-5 py-4">
          {loading && (
            <div className="flex items-center justify-center py-16">
              <IconLoader size={28} className="text-accent" />
            </div>
          )}
          {error && !loading && (
            <div className="flex items-center justify-center py-16 text-sm text-red-400">
              {error}
            </div>
          )}
          {data && !loading && (
            <div className="grid grid-cols-2 gap-3">
              {/* Identity */}
              <Card title="Identity">
                {account.login && <Row label="Логин" value={account.login} />}
                {data.display_name && (
                  <Row label="Имя" value={data.display_name} />
                )}
                {data.steam_id && <Row label="SteamID" value={data.steam_id} />}
                {data.user_country && (
                  <Row label="Страна" value={data.user_country} />
                )}
                <Row
                  label="Телефон"
                  value={
                    data.phone_digits
                      ? `заканч. на ${data.phone_digits}`
                      : "Нет"
                  }
                />
                {data.created_date && (
                  <Row label="Создан" value={data.created_date} />
                )}
              </Card>

              {/* Security & Status */}
              <Card title="Security & Status">
                <Row
                  label="Trade Ban"
                  value={
                    data.trade_ban && data.trade_ban !== "None"
                      ? data.trade_ban
                      : "Нет"
                  }
                  good={!data.trade_ban || data.trade_ban === "None"}
                  bad={!!data.trade_ban && data.trade_ban !== "None"}
                />
                <Row
                  label="Alert"
                  value={
                    data.alert_status && data.alert_status !== "None"
                      ? data.alert_status
                      : "Нет"
                  }
                  good={!data.alert_status || data.alert_status === "None"}
                  bad={!!data.alert_status && data.alert_status !== "None"}
                />
                <Row
                  label="Market Lim"
                  value={data.market_limited ? "Да" : "Нет"}
                  good={!data.market_limited}
                  bad={data.market_limited}
                />
                <Row label="Family" value={data.family_group ? "Да" : "Нет"} />
              </Card>

              {/* Economy & Activity */}
              <Card title="Economy & Activity">
                {data.balance_raw && (
                  <Row label="Баланс" value={data.balance_raw} />
                )}
                {data.steam_level != null && (
                  <Row label="Уровень" value={String(data.steam_level)} />
                )}
                {data.playtime_2weeks > 0 && (
                  <Row
                    label="Время за 2 нед"
                    value={fmtPlaytime(data.playtime_2weeks)}
                  />
                )}
              </Card>

              {/* Inventory */}
              <Card title="Inventory">
                {[
                  {
                    label: "CS2",
                    total: data.inventory_cs2,
                    market: data.inventory_cs2_marketable,
                  },
                  {
                    label: "Dota 2",
                    total: data.inventory_dota2,
                    market: data.inventory_dota2_marketable,
                  },
                  {
                    label: "TF2",
                    total: data.inventory_tf2,
                    market: data.inventory_tf2_marketable,
                  },
                  {
                    label: "Rust",
                    total: data.inventory_rust,
                    market: data.inventory_rust_marketable,
                  },
                ].map(({ label, total, market }) => (
                  <div
                    key={label}
                    className="flex text-[11px] font-mono leading-[1.7]"
                  >
                    <span className="w-27.5 shrink-0 text-gray-500">
                      {label}
                    </span>
                    <span className="text-gray-200">
                      {total}
                      <span className="text-gray-600"> ({market})</span>
                    </span>
                  </div>
                ))}
              </Card>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 px-5 py-2 border-t border-dark-600 text-[10px] text-gray-600">
          {data?.checked_at
            ? `Последняя проверка: ${fmtCheckedAt(data.checked_at)}`
            : "Данные ещё не получены"}
        </div>
      </div>
    </div>
  );
}
