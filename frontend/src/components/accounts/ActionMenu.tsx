import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import type { Account } from "@/api/types";
import { api } from "@/api/client";
import { useAccountStore } from "@/stores/accountStore";
import { useUiStore } from "@/stores/uiStore";
import { IconZap } from "@/components/shared/Icons";
import { useT } from "@/lib/i18n";

const ROW_ACTION_KEYS = [
  { action: "validate", labelKey: "action.validate" },
  { action: "change_password", labelKey: "action.changePassword" },
  { action: "random_password", labelKey: "action.randomPassword" },
  { action: "change_email", labelKey: "action.changeEmail" },
  { action: "change_phone", labelKey: "action.changePhone" },
  { action: "remove_guard", labelKey: "action.removeGuard" },
] as const;

const PARAM_ACTION_KEYS: Record<string, string> = {
  change_password: "prompt.newPassword",
  change_email: "prompt.newEmail",
  change_phone: "prompt.newPhone",
};

const PARAM_KEYS: Record<string, string> = {
  change_password: "new_password",
  change_email: "new_email",
  change_phone: "new_phone",
};

const CONFIRM_ACTION_KEYS: Record<string, string> = {
  remove_guard: "confirm.removeGuard",
};

interface Props {
  account: Account;
  onAction: (id: number, action: string, params: Record<string, string>) => void;
  onToggleAutoAccept: (id: number) => void;
}

export function ActionMenu({ account, onAction, onToggleAutoAccept }: Props) {
  const [open, setOpen] = useState(false);
  const [paramPrompt, setParamPrompt] = useState<{ action: string; title: string } | null>(null);
  const [paramValue, setParamValue] = useState("");
  const [confirmPrompt, setConfirmPrompt] = useState<{ action: string; title: string } | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const addToast = useUiStore((s) => s.addToast);
  const loadAccounts = useAccountStore((s) => s.loadAccounts);
  const t = useT();

  const updatePosition = useCallback(() => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const menuHeight = 320;
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow < menuHeight
      ? Math.max(4, rect.top - menuHeight)
      : rect.bottom + 4;
    const left = Math.max(4, rect.right - 180);
    setMenuPos({ top, left });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    function handleClick(e: MouseEvent) {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    function handleScroll() { setOpen(false); }
    document.addEventListener("mousedown", handleClick);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [open, updatePosition]);

  const handleAction = (action: string, _label: string) => {
    setOpen(false);
    const confirmKey = CONFIRM_ACTION_KEYS[action];
    if (confirmKey) {
      setConfirmPrompt({ action, title: t(confirmKey) });
      return;
    }
    const promptKey = PARAM_ACTION_KEYS[action];
    if (promptKey) {
      setParamPrompt({ action, title: t(promptKey) });
      setParamValue("");
    } else {
      onAction(account.id, action, {});
    }
  };

  const submitParam = () => {
    if (!paramPrompt || !paramValue) return;
    const paramKey = PARAM_KEYS[paramPrompt.action] || "value";
    onAction(account.id, paramPrompt.action, { [paramKey]: paramValue });
    setParamPrompt(null);
  };

  const aaLabel = account.auto_accept ? t("action.disableAutoAccept") : t("action.enableAutoAcceptLogin");

  const handleRemoveProxy = async () => {
    setOpen(false);
    try {
      await api.updateAccount(account.id, { proxy: "" });
      addToast("success", t("toast.proxyCleared", { name: account.login }));
      await loadAccounts();
    } catch (e: unknown) {
      addToast("error", t("misc.error", { error: e instanceof Error ? e.message : String(e) }));
    }
  };

  const handleReassignProxy = async () => {
    setOpen(false);
    try {
      const r = await api.reassignProxies();
      addToast("success", t("toast.proxiesReassigned", { used: r.proxies_used, count: r.assigned }));
      await loadAccounts();
    } catch (e: unknown) {
      addToast("error", t("misc.error", { error: e instanceof Error ? e.message : String(e) }));
    }
  };

  return (
    <>
      <div className="relative inline-block">
        <button ref={btnRef} onClick={() => setOpen(!open)} className="btn-secondary px-2 py-1 text-xs">
          <IconZap size={12} />
        </button>
        {open && menuPos && createPortal(
          <div
            ref={menuRef}
            className="action-menu-dropdown"
            style={{ position: "fixed", top: menuPos.top, left: menuPos.left }}
          >
            {ROW_ACTION_KEYS.map(({ action, labelKey }) => {
              const disabled = action === "remove_guard" && !account.has_revocation_code;
              if (disabled) {
                return (
                  <span key={action} data-tooltip={t("action.noRevocationCode")} className="block">
                    <button className="action-menu-item opacity-40 cursor-not-allowed" disabled>
                      {t(labelKey)}
                    </button>
                  </span>
                );
              }
              return (
                <button key={action} onClick={() => handleAction(action, t(labelKey))} className="action-menu-item">
                  {t(labelKey)}
                </button>
              );
            })}
            <hr className="border-dark-600 my-1" />
            <button onClick={handleRemoveProxy} className="action-menu-item">
              {t("proxy.removeProxy")}
            </button>
            <button onClick={handleReassignProxy} className="action-menu-item">
              {t("proxy.reassignProxy")}
            </button>
            <hr className="border-dark-600 my-1" />
            <button onClick={() => { setOpen(false); onToggleAutoAccept(account.id); }} className="action-menu-item">
              {aaLabel}
            </button>
          </div>,
          document.body,
        )}
      </div>

      {paramPrompt && (
        <div className="confirm-overlay" onMouseDown={() => setParamPrompt(null)}>
          <div className="confirm-box" onMouseDown={(e) => e.stopPropagation()}>
            <p className="text-sm text-gray-300 mb-3">{paramPrompt.title}</p>
            <input
              autoFocus
              value={paramValue}
              onChange={(e) => setParamValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitParam()}
              className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm mb-3"
              placeholder={paramPrompt.action.includes("phone") ? "+7 9123456789" : undefined}
            />
            <div className="flex gap-2">
              <button onClick={submitParam} className="btn-primary flex-1">OK</button>
              <button onClick={() => setParamPrompt(null)} className="btn-secondary flex-1">{t("btn.cancel")}</button>
            </div>
          </div>
        </div>
      )}

      {confirmPrompt && (
        <div className="confirm-overlay" onMouseDown={() => setConfirmPrompt(null)}>
          <div className="confirm-box" onMouseDown={(e) => e.stopPropagation()}>
            <p className="text-sm text-gray-300 mb-3">{confirmPrompt.title}</p>
            <div className="flex gap-2">
              <button
                autoFocus
                onClick={() => {
                  onAction(account.id, confirmPrompt.action, {});
                  setConfirmPrompt(null);
                }}
                className="btn-primary flex-1"
              >
                {t("confirm.yes")}
              </button>
              <button onClick={() => setConfirmPrompt(null)} className="btn-secondary flex-1">{t("btn.cancel")}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
