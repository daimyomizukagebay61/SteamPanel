import { useState, useRef } from "react";
import type { AccountCreate } from "@/api/types";
import { api } from "@/api/client";
import { useUiStore } from "@/stores/uiStore";

import { IconUpload } from "@/components/shared/Icons";
import { useT } from "@/lib/i18n";

interface Props {
  onSave: (data: AccountCreate) => void;
  onClose: () => void;
}

export function AddModal({ onSave, onClose }: Props) {
  const t = useT();
  const addToast = useUiStore((s) => s.addToast);

  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  const [proxy, setProxy] = useState("");
  const [notes, setNotes] = useState("");
  const [mafile, setMafile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const parseLoginPass = (value: string) => {
    const sep = value.includes("|") ? "|" : ":";
    const parts = value.split(sep);
    if (parts.length >= 2) {
      setLogin(parts[0]);
      setPassword(parts[1]);
      if (parts.length >= 3) setEmail(parts[2]);
      if (parts.length >= 4) setEmailPassword(parts[3]);
    } else {
      setLogin(value);
    }
  };

  const handleSave = async () => {
    if (!login || !password) return;
    setSaving(true);
    try {
      onSave({
        login,
        password,
        email: email || undefined,
        email_password: emailPassword || undefined,
        proxy: proxy || undefined,
        notes: notes || undefined,
      });

      if (mafile) {
        await api.uploadMafiles([mafile]);
      }
    } catch (e: unknown) {
      addToast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="confirm-overlay" onMouseDown={onClose}>
      <div
        className="confirm-box max-w-md"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold mb-4">{t("modal.addAccount")}</h3>
        <div className="space-y-3">
          <input
            autoFocus
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            onPaste={(e) => {
              const text = e.clipboardData.getData("text").trim();
              if (text.includes(":") || text.includes("|")) {
                e.preventDefault();
                parseLoginPass(text);
              }
            }}
            placeholder={t("ph.login") + "  (login:pass)"}
            className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm"
          />
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("ph.password")}
            className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              className="bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm"
            />
            <input
              value={emailPassword}
              onChange={(e) => setEmailPassword(e.target.value)}
              placeholder={t("ph.emailPassword")}
              className="bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input
              value={proxy}
              onChange={(e) => setProxy(e.target.value)}
              placeholder={t("ph.proxyOptional")}
              className="bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm"
            />
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("ph.notesOptional")}
              className="bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm"
            />
          </div>

          <div
            onClick={() => fileRef.current?.click()}
            className="border border-dashed border-dark-500 rounded p-3 text-center cursor-pointer transition-colors hover:border-accent flex items-center justify-center gap-2"
          >
            <IconUpload size={14} className="text-gray-500" />
            <span className="text-xs text-gray-400">
              {mafile ? mafile.name : t("import.attachMafile")}
            </span>
            {mafile && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setMafile(null);
                }}
                className="text-xs text-red-400 hover:text-red-300 ml-1"
              >
                ✕
              </button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".mafile"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) setMafile(f);
            }}
          />

          <button
            onClick={handleSave}
            disabled={!login || !password || saving}
            className="btn-primary w-full"
          >
            {saving ? t("import.uploading") : t("btn.add")}
          </button>
        </div>
      </div>
    </div>
  );
}
