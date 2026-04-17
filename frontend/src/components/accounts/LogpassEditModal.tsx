import { useState } from "react";
import { api } from "@/api/client";
import { useLogpassStore } from "@/stores/logpassStore";
import type { LogpassAccount } from "@/api/types";
import { useT } from "@/lib/i18n";

interface Props {
  account: LogpassAccount;
  onClose: () => void;
}

export function LogpassEditModal({ account, onClose }: Props) {
  const t = useT();
  const [login, setLogin] = useState(account.login);
  const [password, setPassword] = useState(account.password);
  const [proxy, setProxy] = useState(account.proxy ?? "");
  const [notes, setNotes] = useState(account.notes ?? "");
  const loadAccounts = useLogpassStore((s) => s.loadAccounts);

  const handleSave = async () => {
    if (!login || !password) return;
    await api.updateLogpassAccount(account.id, {
      login,
      password,
      proxy: proxy || undefined,
      notes: notes || undefined,
    });
    await loadAccounts();
    onClose();
  };

  return (
    <div className="confirm-overlay" onMouseDown={onClose}>
      <div className="confirm-box max-w-md" onMouseDown={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold mb-4">{t("modal.editAccount")}</h3>
        <div className="space-y-3">
          <input
            autoFocus
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            placeholder={t("ph.login")}
            className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm"
          />
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("ph.password")}
            className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm"
          />
          <input
            value={proxy}
            onChange={(e) => setProxy(e.target.value)}
            placeholder={t("ph.proxyOptional")}
            className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm"
          />
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t("ph.notes")}
            className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <button onClick={handleSave} className="btn-primary flex-1">{t("btn.save")}</button>
            <button onClick={onClose} className="btn-secondary flex-1">{t("btn.cancel")}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
