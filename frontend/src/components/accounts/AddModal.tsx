import { useState } from "react";
import type { AccountCreate } from "@/api/types";
import { useT } from "@/lib/i18n";

interface Props {
  onSave: (data: AccountCreate) => void;
  onClose: () => void;
}

export function AddModal({ onSave, onClose }: Props) {
  const t = useT();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [proxy, setProxy] = useState("");

  const handleSave = () => {
    if (!login || !password) return;
    onSave({
      login,
      password,
      email: email || undefined,
      proxy: proxy || undefined,
    });
  };

  return (
    <div className="confirm-overlay" onMouseDown={onClose}>
      <div className="confirm-box max-w-md" onMouseDown={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold mb-4">{t("modal.addAccount")}</h3>
        <div className="space-y-3">
          <input autoFocus value={login} onChange={(e) => setLogin(e.target.value)} placeholder={t("ph.login")} className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm" />
          <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("ph.password")} className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm" />
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm" />
          <input value={proxy} onChange={(e) => setProxy(e.target.value)} placeholder={t("ph.proxy")} className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm" />
          <button onClick={handleSave} className="btn-primary w-full">{t("btn.add")}</button>
        </div>
      </div>
    </div>
  );
}
