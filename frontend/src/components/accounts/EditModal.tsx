import { useState, useRef, useEffect } from "react";
import type { Account, AccountUpdate } from "@/api/types";
import { useT } from "@/lib/i18n";

interface Props {
  account: Account;
  onSave: (id: number, data: AccountUpdate) => void;
  onClose: () => void;
}

export function EditModal({ account, onSave, onClose }: Props) {
  const t = useT();
  const [login, setLogin] = useState(account.login);
  const [password, setPassword] = useState(account.password);
  const [email, setEmail] = useState(account.email ?? "");
  const [proxy, setProxy] = useState(account.proxy ?? "");
  const [notes, setNotes] = useState(account.notes ?? "");
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { ref.current?.focus(); }, []);

  const handleSave = () => {
    onSave(account.id, {
      login,
      password,
      email: email || undefined,
      proxy: proxy || undefined,
      notes: notes || undefined,
    });
  };

  return (
    <div className="confirm-overlay" onMouseDown={onClose}>
      <div className="confirm-box max-w-md" onMouseDown={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold mb-4">{t("modal.editAccount")}</h3>
        <div className="space-y-3">
          <input ref={ref} value={login} onChange={(e) => setLogin(e.target.value)} placeholder={t("ph.login")} className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm" />
          <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("ph.password")} className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm" />
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm" />
          <input value={proxy} onChange={(e) => setProxy(e.target.value)} placeholder={t("ph.proxy")} className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm" />
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("ph.notes")} className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm" />
          <button onClick={handleSave} className="btn-primary w-full">{t("btn.save")}</button>
        </div>
      </div>
    </div>
  );
}
