import { useState } from "react";
import { api } from "@/api/client";
import { useTokenStore } from "@/stores/tokenStore";
import type { TokenAccountCreate } from "@/api/types";
import { useT } from "@/lib/i18n";

interface Props {
  onClose: () => void;
}

export function TokenAddModal({ onClose }: Props) {
  const t = useT();
  const [token, setToken] = useState("");
  const [login, setLogin] = useState("");
  const [proxy, setProxy] = useState("");
  const [notes, setNotes] = useState("");
  const loadAccounts = useTokenStore((s) => s.loadAccounts);

  const handleSave = async () => {
    if (!token.trim()) return;
    const data: TokenAccountCreate = {
      token: token.trim(),
      login: login.trim() || undefined,
      proxy: proxy.trim() || undefined,
      notes: notes.trim() || undefined,
    };
    await api.createTokenAccount(data);
    await loadAccounts();
    onClose();
  };

  return (
    <div className="confirm-overlay" onMouseDown={onClose}>
      <div className="confirm-box max-w-md" onMouseDown={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold mb-4">{t("modal.addToken")}</h3>
        <div className="space-y-3">
          <textarea
            autoFocus
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Refresh token"
            rows={3}
            className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm font-mono resize-none"
          />
          <input value={login} onChange={(e) => setLogin(e.target.value)} placeholder={t("ph.loginOptional")} className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm" />
          <input value={proxy} onChange={(e) => setProxy(e.target.value)} placeholder={t("ph.proxyOptional")} className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm" />
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("ph.notesOptional")} className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm" />
          <button onClick={handleSave} disabled={!token.trim()} className="btn-primary w-full disabled:opacity-40">{t("btn.add")}</button>
        </div>
      </div>
    </div>
  );
}
