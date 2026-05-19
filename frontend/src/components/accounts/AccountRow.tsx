import { useState } from "react";
import type { Account, ColumnSettings } from "@/api/types";
import { useAccountStore } from "@/stores/accountStore";
import { copyText } from "@/lib/clipboard";
import { useUiStore } from "@/stores/uiStore";
import { api } from "@/api/client";
import { StatusBadge, BanBadge, MafileBadge, VacBadge, LimitBadge, CountryBadge } from "./Badges";
import { ActionMenu } from "./ActionMenu";
import { SteamLevelBadge } from "./SteamLevelBadge";
import { IconCheck, IconCheckCircle, IconAlertTriangle, IconEye, IconEyeOff, IconKey, IconRefresh, IconEdit, IconTrash } from "@/components/shared/Icons";
import { useT } from "@/lib/i18n";

interface Props {
  account: Account;
  visibleColumns: ColumnSettings;
  proxyLabel: string | null;
  isProcessing: boolean;
  accountResult?: { status: string; error?: string };
  accountStep?: { step: number; total: number };
  onEdit: (id: number) => void;
  onDelete: (id: number) => void;
  onAction: (id: number, action: string, params: Record<string, string>) => void;
  onToggleAutoAccept: (id: number) => void;
  onToggleAutoConfirm: (id: number) => void;
  onOpenBrowser: (id: number) => void;
}

export function AccountRow({ account: a, visibleColumns: v, proxyLabel, isProcessing, accountResult, accountStep, onEdit, onDelete, onAction, onToggleAutoAccept, onToggleAutoConfirm, onOpenBrowser }: Props) {
  const selectedIds = useAccountStore((s) => s.selectedIds);
  const toggleSelect = useAccountStore((s) => s.toggleSelect);
  const addToast = useUiStore((s) => s.addToast);
  const hidePasswords = useUiStore((s) => s.hidePasswords);
  const [revealed, setRevealed] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState(a.notes || "");
  const t = useT();


  const handleCopy = async (text: string) => {
    const ok = await copyText(text);
    addToast(ok ? "success" : "error", ok ? t("toast.copied") : t("toast.copyFailed"));
  };

  const masked = hidePasswords && !revealed;
  const dots = "••••••••";

  return (
    <tr className="hover:bg-dark-700/50 transition">
      <td className="px-3 py-2">
        <input
          type="checkbox"
          checked={selectedIds.has(a.id)}
          onChange={() => toggleSelect(a.id)}
        />
      </td>
      <td className="px-1 py-2 w-5">
        {isProcessing ? (
          <div className="flex items-center gap-1">
            <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin shrink-0" />
            {accountStep && (
              <span className="text-[10px] text-gray-500 whitespace-nowrap">[{accountStep.step}/{accountStep.total}]</span>
            )}
          </div>
        ) : accountResult?.status === "ok" ? (
          <IconCheck size={16} className="text-gray-400" />
        ) : accountResult?.status === "error" ? (
          <span title={accountResult.error?.toLowerCase().includes("proxy") || accountResult.error?.toLowerCase().includes("network") || accountResult.error?.includes("WinError") ? t("tip.proxyError", { error: accountResult.error }) : accountResult.error}>
            <IconAlertTriangle size={16} className="text-red-400" />
          </span>
        ) : null}
      </td>
      {v.browser && (
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
      {v.profile && (
        <td className="px-3 py-2 whitespace-nowrap">
          <div className="flex items-center gap-1.5">
            {a.avatar_url && <img src={a.avatar_url} className="avatar-sm" alt="" />}
            <span className="text-xs">{a.nickname || "—"}</span>
            {a.steam_level != null && <SteamLevelBadge level={a.steam_level} />}
          </div>
        </td>
      )}
      {v.last_online && (
        <td className="px-3 py-2 text-xs text-gray-400 whitespace-nowrap">
          {a.last_online || "—"}
        </td>
      )}
      {v.steam_id && (
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
          ) : "—"}
        </td>
      )}
      {v.login && <td className="px-3 py-2 font-medium">{a.login}</td>}
      {v.password && (
        <td className="px-3 py-2 text-gray-400 select-none whitespace-nowrap">
          <span
            className="cell-copy cursor-pointer"
            onClick={() => handleCopy(a.password)}
            title={t("tip.copyPassword")}
          >
            {masked ? dots : a.password}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); setRevealed(!revealed); }}
            className="ml-1.5 text-gray-500 hover:text-gray-300 inline-flex align-middle"
            title={masked ? t("tip.show") : t("tip.hide")}
          >
            {masked ? <IconEye size={14} /> : <IconEyeOff size={14} />}
          </button>
        </td>
      )}
      {v.login_pass && (
        <td className="px-3 py-2 text-gray-400 text-xs select-none whitespace-nowrap">
          <span
            className="cell-copy cursor-pointer"
            onClick={() => handleCopy(`${a.login}:${a.password}`)}
            title={t("tip.copyLoginPass")}
          >
            {masked ? `${a.login}:${dots}` : `${a.login}:${a.password}`}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); setRevealed(!revealed); }}
            className="ml-1.5 text-gray-500 hover:text-gray-300 inline-flex align-middle"
            title={masked ? t("tip.show") : t("tip.hide")}
          >
            {masked ? <IconEye size={14} /> : <IconEyeOff size={14} />}
          </button>
        </td>
      )}
      {v.email && <td className="px-3 py-2 text-gray-400 text-xs">{a.email || "—"}</td>}
      {v.email_pass && (
        <td className="px-3 py-2 text-gray-400 text-xs select-none whitespace-nowrap">
          <span
            className="cell-copy cursor-pointer"
            onClick={() => { if (a.email_password) handleCopy(a.email_password); }}
            title={a.email_password ? t("tip.copyEmailPass") : ""}
          >
            {a.email_password ? (masked ? dots : a.email_password) : "—"}
          </span>
          {a.email_password && (
            <button
              onClick={(e) => { e.stopPropagation(); setRevealed(!revealed); }}
              className="ml-1.5 text-gray-500 hover:text-gray-300 inline-flex align-middle"
              title={masked ? t("tip.show") : t("tip.hide")}
            >
              {masked ? <IconEye size={14} /> : <IconEyeOff size={14} />}
            </button>
          )}
        </td>
      )}
      {v.email_login_pass && (
        <td className="px-3 py-2 text-gray-400 text-xs select-none whitespace-nowrap">
          <span
            className="cell-copy cursor-pointer"
            onClick={() => { if (a.email && a.email_password) handleCopy(`${a.email}:${a.email_password}`); }}
            title={a.email && a.email_password ? t("tip.copyEmailLoginPass") : ""}
          >
            {a.email && a.email_password ? (masked ? `${a.email}:${dots}` : `${a.email}:${a.email_password}`) : "—"}
          </span>
          {a.email && a.email_password && (
            <button
              onClick={(e) => { e.stopPropagation(); setRevealed(!revealed); }}
              className="ml-1.5 text-gray-500 hover:text-gray-300 inline-flex align-middle"
              title={masked ? t("tip.show") : t("tip.hide")}
            >
              {masked ? <IconEye size={14} /> : <IconEyeOff size={14} />}
            </button>
          )}
        </td>
      )}
      {v.phone && <td className="px-3 py-2 text-gray-400 text-xs">{a.phone || "—"}</td>}
      {v.status && <td className="px-3 py-2"><StatusBadge status={a.status} /></td>}
      {v.ban && <td className="px-3 py-2"><BanBadge status={a.ban_status} /></td>}
      {v.vac && <td className="px-3 py-2"><VacBadge status={a.vac_status} games={a.vac_games} /></td>}
      {v.limit && <td className="px-3 py-2"><LimitBadge status={a.limit_status} /></td>}
      {v.balance && (
        <td className="px-3 py-2 text-xs font-mono text-gray-300 whitespace-nowrap">
          {a.balance || "—"}
        </td>
      )}
      {v.country && (
        <td className="px-3 py-2">
          <CountryBadge country={a.country} />
        </td>
      )}
      {v.twofa && (
        <td className="px-3 py-2 whitespace-nowrap">
          {a.shared_secret ? (
            <button
              onClick={async () => {
                try {
                  const { code } = await api.generate2FA(a.shared_secret!);
                  await copyText(code);
                  addToast("success", t("twofa.copied", { code }));
                } catch (e: unknown) {
                  addToast("error", t("twofa.error", { error: e instanceof Error ? e.message : String(e) }));
                }
              }}
              className="text-accent hover:underline text-xs"
              title={t("tip.gen2fa")}
            >
              <IconKey size={12} className="inline mr-0.5" /> {t("tip.code")}
            </button>
          ) : (
            <span className="text-gray-600 text-xs">—</span>
          )}
        </td>
      )}
      {v.mafile && (
        <td className="px-3 py-2">
          <MafileBadge hasMafile={!!a.mafile_path} />
        </td>
      )}
      {v.proxy && (
        <td className="px-3 py-2 text-xs">
          {a.proxy ? (
            <span
              className="text-blue-400 cursor-pointer hover:underline"
              onClick={() => handleCopy(a.proxy!)}
              title={a.proxy}
            >
              {proxyLabel || a.proxy}
            </span>
          ) : "—"}
        </td>
      )}
      {v.notes && (
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
                    await api.updateAccount(a.id, { notes: notesValue });
                    addToast("success", t("toast.noteSaved"));
                    useAccountStore.getState().loadAccounts();
                  } catch {
                    addToast("error", t("toast.noteSaveError"));
                  }
                }
              }}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setNotesValue(a.notes || ""); setEditingNotes(false); } }}
            />
          ) : (
            <span
              className="cursor-pointer text-gray-400 hover:text-gray-200 truncate block"
              onClick={() => { setNotesValue(a.notes || ""); setEditingNotes(true); }}
              title={a.notes || t("tip.addNote")}
            >
              {a.notes || "—"}
            </span>
          )}
        </td>
      )}
      {v.actions && (
        <td className="px-3 py-2 whitespace-nowrap">
          <div className="flex items-center gap-1.5">
            <ActionMenu account={a} onAction={onAction} onToggleAutoAccept={onToggleAutoAccept} onToggleAutoConfirm={onToggleAutoConfirm} />
            <button onClick={() => onEdit(a.id)} className="text-gray-400 hover:text-accent" title={t("tip.edit")}><IconEdit size={14} /></button>
            <button onClick={() => onDelete(a.id)} className="text-gray-400 hover:text-red-400" title={t("tip.delete")}><IconTrash size={14} /></button>
            {a.auto_accept ? (
              <span
                title={t("tip.autoAcceptActive")}
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-accent/20 border border-accent/50 text-accent text-[10px] font-bold leading-none"
              >
                <IconRefresh size={10} />
                AA
              </span>
            ) : null}
            {a.auto_confirm ? (
              <span
                title={t("tip.autoConfirmActive")}
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-green-500/20 border border-green-500/50 text-green-400 text-[10px] font-bold leading-none"
              >
                <IconCheckCircle size={10} />
                AC
              </span>
            ) : null}
          </div>
        </td>
      )}
    </tr>
  );
}
