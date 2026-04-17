import { useState, useRef, useEffect } from "react";
import { useT } from "@/lib/i18n";

interface ConfirmModalProps {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({ message, onConfirm, onCancel }: ConfirmModalProps) {
  const t = useT();
  return (
    <div className="confirm-overlay" onMouseDown={onCancel}>
      <div className="confirm-box" onMouseDown={(e) => e.stopPropagation()}>
        <p className="text-sm text-gray-300 mb-4">{message}</p>
        <div className="flex gap-2">
          <button onClick={onConfirm} className="btn-primary flex-1">{t("confirm.yes")}</button>
          <button onClick={onCancel} className="btn-secondary flex-1">{t("btn.cancel")}</button>
        </div>
      </div>
    </div>
  );
}

interface InputModalProps {
  title: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

export function InputModal({ title, onSubmit, onCancel }: InputModalProps) {
  const t = useT();
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="confirm-overlay" onMouseDown={onCancel}>
      <div className="confirm-box" onMouseDown={(e) => e.stopPropagation()}>
        <p className="text-sm text-gray-300 mb-3">{title}</p>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && value && onSubmit(value)}
          className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm mb-3"
        />
        <div className="flex gap-2">
          <button onClick={() => value && onSubmit(value)} className="btn-primary flex-1">OK</button>
          <button onClick={onCancel} className="btn-secondary flex-1">{t("btn.cancel")}</button>
        </div>
      </div>
    </div>
  );
}
