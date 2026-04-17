import { useState, useRef } from "react";
import { api } from "@/api/client";
import { useUiStore } from "@/stores/uiStore";
import { useAccountStore } from "@/stores/accountStore";
import { IconUpload } from "@/components/shared/Icons";
import { useT } from "@/lib/i18n";

interface Props {
  onClose: () => void;
}

export function ImportModal({ onClose }: Props) {
  const t = useT();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const addToast = useUiStore((s) => s.addToast);
  const loadAccounts = useAccountStore((s) => s.loadAccounts);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) setFile(f);
  };

  const doImport = async () => {
    if (!file) return;
    setUploading(true);
    try {
      const res = await api.importAccounts(file);
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
          <p className="font-medium text-gray-300">{t("import.formats")} <span className="text-gray-500 font-normal">({t("import.delimiter")} <code className="text-accent">:</code> {t("import.or")} <code className="text-accent">|</code>)</span></p>
          <p className="font-mono text-xs">login:pass:{"{"}mafile{"}"}</p>
          <p className="font-mono text-xs">login:pass:email:email_pass:{"{"}mafile{"}"}</p>
          <p className="font-mono text-xs">login:pass:email:email_pass</p>
        </div>
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className="border-2 border-dashed border-dark-500 rounded-lg p-6 mb-3 text-center cursor-pointer transition-colors hover:border-accent"
        >
          <IconUpload size={32} className="mx-auto mb-2 text-gray-500" />
          <p className="text-sm text-gray-400">
            {file ? t("import.selected", { name: file.name }) : t("import.dragTxt")}
          </p>
        </div>
        <input ref={inputRef} type="file" accept=".txt" className="hidden" onChange={(e) => {
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
