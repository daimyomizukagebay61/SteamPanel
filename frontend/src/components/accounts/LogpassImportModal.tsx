import { useState, useRef } from "react";
import { api } from "@/api/client";
import { useLogpassStore } from "@/stores/logpassStore";
import { useUiStore } from "@/stores/uiStore";
import { IconUpload } from "@/components/shared/Icons";
import { useT } from "@/lib/i18n";

interface Props {
  onClose: () => void;
}

export function LogpassImportModal({ onClose }: Props) {
  const t = useT();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState("");
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const addToast = useUiStore((s) => s.addToast);
  const loadAccounts = useLogpassStore((s) => s.loadAccounts);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) setFile(f);
  };

  const doImport = async () => {
    if (!file) return;
    setUploading(true);
    try {
      const text = await file.text();
      const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
      if (!lines.length) { setResult(t("toast.fileEmpty")); setUploading(false); return; }
      const res = await api.importLogpass(lines);
      setResult(t("toast.importResult", { imported: res.imported, skipped: res.skipped }));
      addToast("success", `${res.imported} ok, ${res.skipped} skip`);
      await loadAccounts();
    } catch (e: unknown) {
      setResult(e instanceof Error ? e.message : t("misc.errorStr"));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="confirm-overlay" onMouseDown={onClose}>
      <div className="confirm-box max-w-lg w-full" onMouseDown={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold mb-4">{t("modal.importAccounts")}</h3>
        <div className="text-sm text-gray-400 mb-3 space-y-1">
          <p className="font-medium text-gray-300">{t("import.formatsColon")}</p>
          <p className="font-mono text-xs">login:pass</p>
          <p className="font-mono text-xs">login|pass</p>
          <p className="font-mono text-xs">CSV: login,password,steam_id,ban,prime,trophy,behavior,license</p>
          <p className="text-xs text-yellow-500/80 mt-1">⚠ Mafile-файлы и JSON не принимаются. Только log:pass / log|pass.</p>
        </div>
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className="border-2 border-dashed border-dark-500 rounded-lg p-6 mb-3 text-center cursor-pointer transition-colors hover:border-accent"
        >
          <IconUpload size={32} className="mx-auto mb-2 text-gray-500" />
          <p className="text-sm text-gray-400">
            {file ? t("import.selected", { name: file.name }) : t("import.dragTxtCsv")}
          </p>
        </div>
        <input ref={inputRef} type="file" accept=".txt,.csv" className="hidden" onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) setFile(f);
        }} />
        <button onClick={doImport} disabled={!file || uploading} className="btn-primary w-full">
          {uploading ? t("import.uploading") : t("import.importBtn")}
        </button>
        {result && <p className="mt-3 text-sm text-gray-300">{result}</p>}
      </div>
    </div>
  );
}
