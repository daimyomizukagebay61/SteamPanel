import { useState } from "react";
import { api } from "@/api/client";
import { useLogpassStore } from "@/stores/logpassStore";
import type { LogpassAccountCreate } from "@/api/types";
import { useT } from "@/lib/i18n";

interface Props {
  onClose: () => void;
}

export function LogpassAddModal({ onClose }: Props) {
  const t = useT();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [proxy, setProxy] = useState("");
  const loadAccounts = useLogpassStore((s) => s.loadAccounts);

  const handleSave = async () => {
    if (!login || !password) return;
    const data: LogpassAccountCreate = {
      login,
      password,
      proxy: proxy || undefined,
    };
    await api.createLogpassAccount(data);
    await loadAccounts();
    onClose();
  };

  return (
    <div className="confirm-overlay" onMouseDown={onClose}>
      <div className="confirm-box max-w-md" onMouseDown={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold mb-4">{t("modal.addAccount")}</h3>
        <div className="space-y-3">
          <input autoFocus value={login} onChange={(e) => setLogin(e.target.value)} placeholder={t("ph.login")} className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm" />
          <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("ph.password")} className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm" />
          <input value={proxy} onChange={(e) => setProxy(e.target.value)} placeholder={t("ph.proxyOptional")} className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm" />
          <button onClick={handleSave} className="btn-primary w-full">{t("btn.add")}</button>
        </div>
      </div>
    </div>
  );
}
