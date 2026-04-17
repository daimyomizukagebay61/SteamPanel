import { useRef } from "react";
import { IconUpload } from "@/components/shared/Icons";
import { useT } from "@/lib/i18n";

interface Props {
  onFiles: (files: File[]) => void;
}

export function DropZone({ onFiles }: Props) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter((f) => f.name.endsWith(".mafile"));
    if (files.length) onFiles(files);
  };

  return (
    <>
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className="border-2 border-dashed border-dark-500 rounded-lg p-6 text-center cursor-pointer transition-colors hover:border-accent"
      >
        <IconUpload size={32} className="mx-auto mb-2 text-gray-500" />
        <p className="text-sm text-gray-400">{t("import.dragMafile")}</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".mafile"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onFiles(files);
          e.target.value = "";
        }}
      />
    </>
  );
}
