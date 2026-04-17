import { useState, useEffect, useRef } from "react";
import type { Proxy } from "@/api/types";
import { api } from "@/api/client";
import { useUiStore } from "@/stores/uiStore";
import { IconUpload, IconGlobe } from "@/components/shared/Icons";
import { useT } from "@/lib/i18n";

type ProxyFormat =
  | "login:pass@ip:port"
  | "login:pass:ip:port"
  | "ip:port@login:pass"
  | "ip:port:login:pass"
  | "custom";

interface ParsedProxy {
  address: string;
  protocol: string;
}

const BUILTIN_FORMATS: { value: ProxyFormat; label: string }[] = [
  { value: "login:pass@ip:port", label: "login:pass@ip:port" },
  { value: "login:pass:ip:port", label: "login:pass:ip:port" },
  { value: "ip:port@login:pass", label: "ip:port@login:pass" },
  { value: "ip:port:login:pass", label: "ip:port:login:pass" },
];

function parseProxyLine(raw: string, format: ProxyFormat, defaultProtocol: string, customParts?: string[]): ParsedProxy | null {
  let line = raw.trim();
  if (!line) return null;

  // Strip protocol prefix if present, fall back to user-selected default
  let protocol = defaultProtocol;
  for (const proto of ["socks5://", "socks4://", "http://", "https://"]) {
    if (line.toLowerCase().startsWith(proto)) {
      protocol = proto.replace("://", "");
      line = line.slice(proto.length);
      break;
    }
  }

  // If no auth separators detected, treat as plain ip:port
  if (!line.includes("@") && line.split(":").length === 2) {
    return { address: line, protocol };
  }

  let ip = "", port = "", login = "", pass = "";

  if (format === "custom" && customParts && customParts.length >= 4) {
    // Custom format: user defines order of [ip, port, login, pass] with separator between them
    // customParts = [part0, sep0, part1, sep1, part2, sep2, part3]
    // We rebuild a regex from it
    const result = parseCustomFormat(line, customParts);
    if (!result) return null;
    ({ ip, port, login, pass } = result);
  } else if (format === "login:pass@ip:port") {
    const atIdx = line.indexOf("@");
    if (atIdx === -1) return null;
    const auth = line.slice(0, atIdx);
    const host = line.slice(atIdx + 1);
    const authParts = auth.split(":");
    const hostParts = host.split(":");
    if (authParts.length < 2 || hostParts.length < 2) return null;
    login = authParts[0]; pass = authParts.slice(1).join(":");
    ip = hostParts[0]; port = hostParts[1];
  } else if (format === "login:pass:ip:port") {
    const parts = line.split(":");
    if (parts.length < 4) return null;
    login = parts[0]; pass = parts[1]; ip = parts[2]; port = parts[3];
  } else if (format === "ip:port@login:pass") {
    const atIdx = line.indexOf("@");
    if (atIdx === -1) return null;
    const host = line.slice(0, atIdx);
    const auth = line.slice(atIdx + 1);
    const hostParts = host.split(":");
    const authParts = auth.split(":");
    if (hostParts.length < 2 || authParts.length < 2) return null;
    ip = hostParts[0]; port = hostParts[1];
    login = authParts[0]; pass = authParts.slice(1).join(":");
  } else if (format === "ip:port:login:pass") {
    const parts = line.split(":");
    if (parts.length < 4) return null;
    ip = parts[0]; port = parts[1]; login = parts[2]; pass = parts[3];
  }

  if (!ip || !port) return null;
  const address = login && pass ? `${login}:${pass}@${ip}:${port}` : `${ip}:${port}`;
  return { address, protocol };
}

function parseCustomFormat(line: string, customParts: string[]): { ip: string; port: string; login: string; pass: string } | null {
  // customParts = [field, sep, field, sep, field, sep, field]
  // fields: "ip" | "port" | "login" | "pass"
  // seps: any string like ":" or "@"
  const fields: string[] = [];
  const seps: string[] = [];
  for (let i = 0; i < customParts.length; i++) {
    if (i % 2 === 0) fields.push(customParts[i]);
    else seps.push(customParts[i]);
  }
  if (fields.length !== 4 || seps.length !== 3) return null;

  // Split line by separators sequentially
  let remaining = line;
  const values: string[] = [];
  for (let i = 0; i < seps.length; i++) {
    const idx = remaining.indexOf(seps[i]);
    if (idx === -1) return null;
    values.push(remaining.slice(0, idx));
    remaining = remaining.slice(idx + seps[i].length);
  }
  values.push(remaining);

  const result: Record<string, string> = {};
  for (let i = 0; i < fields.length; i++) {
    result[fields[i]] = values[i];
  }
  return { ip: result.ip || "", port: result.port || "", login: result.login || "", pass: result.pass || "" };
}

const CUSTOM_FIELDS = ["ip", "port", "login", "pass"];
const CUSTOM_SEPS = [":", "@", ";", "|", "-"];

export function ProxyManager() {
  const [proxies, setProxies] = useState<Proxy[]>([]);
  const [text, setText] = useState("");
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<string>("");
  const [format, setFormat] = useState<ProxyFormat>("login:pass@ip:port");
  const [protocol, setProtocol] = useState<string>("http");
  const [showCustom, setShowCustom] = useState(false);
  const [customParts, setCustomParts] = useState<string[]>(["ip", ":", "port", "@", "login", ":", "pass"]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const addToast = useUiStore((s) => s.addToast);
  const t = useT();

  const load = async () => {
    try {
      setProxies(await api.getProxies());
    } catch { /* ignore */ }
  };

  useEffect(() => { load(); }, []);

  const parseAndAdd = async (rawText: string) => {
    const lines = rawText.split("\n").filter((l) => l.trim());
    if (!lines.length) return;

    const activeFormat = showCustom ? "custom" : format;
    const parsed: ParsedProxy[] = [];
    for (const line of lines) {
      const p = parseProxyLine(line, activeFormat, protocol, showCustom ? customParts : undefined);
      if (p) parsed.push(p);
    }
    if (!parsed.length) {
      addToast("error", t("toast.proxyFormatError"));
      return;
    }
    try {
      const result = await api.bulkAddProxies(parsed);
      addToast("success", t("toast.proxiesAdded", { count: result.added }));
      setText("");
      await load();
    } catch (e: unknown) {
      addToast("error", t("misc.error", { error: e instanceof Error ? e.message : String(e) }));
    }
  };

  const addProxies = () => parseAndAdd(text);

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const content = await file.text();
    await parseAndAdd(content);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const content = await file.text();
    await parseAndAdd(content);
    e.target.value = "";
  };

  const deleteProxy = async (id: number) => {
    try {
      await api.deleteProxy(id);
      await load();
    } catch (e: unknown) {
      addToast("error", t("misc.error", { error: e instanceof Error ? e.message : String(e) }));
    }
  };

  const deleteAll = async () => {
    if (!proxies.length) return;
    if (!window.confirm(t("proxy.confirmDeleteAll"))) return;
    try {
      const r = await api.deleteAllProxies();
      addToast("success", t("toast.proxiesDeleted", { count: r.deleted }));
      setCheckResult("");
      await load();
    } catch (e: unknown) {
      addToast("error", t("misc.error", { error: e instanceof Error ? e.message : String(e) }));
    }
  };

  const checkAll = async () => {
    setChecking(true);
    setCheckResult("");
    try {
      const r = await api.checkProxies();
      const msg = t("proxy.checkResult", { total: r.total, alive: r.alive, dead: r.dead });
      setCheckResult(msg);
      await load();
    } catch (e: unknown) {
      addToast("error", t("misc.proxyErrorCheck", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setChecking(false);
    }
  };

  const updateCustomPart = (idx: number, value: string) => {
    const next = [...customParts];
    next[idx] = value;
    setCustomParts(next);
  };

  const customPreview = customParts.join("");

  return (
    <div className="bg-dark-800 border border-dark-600 rounded-lg p-4">
      <h3 className="font-semibold mb-3">
        <IconGlobe size={14} className="inline mr-1" />{t("proxy.title")} <span className="text-xs text-gray-500 ml-2">{t("proxy.count", { count: proxies.length })}</span>
      </h3>

      {/* Format selector */}
      <div className="mb-3 space-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs text-gray-400">{t("proxy.protocol")}</span>
          <select
            value={protocol}
            onChange={(e) => setProtocol(e.target.value)}
            className="bg-dark-700 border border-dark-600 rounded px-2 py-1 text-xs"
          >
            <option value="http">HTTP</option>
            <option value="socks5">SOCKS5</option>
          </select>
          <span className="text-xs text-gray-400">{t("proxy.format")}</span>
          <select
            value={showCustom ? "__custom__" : format}
            onChange={(e) => {
              if (e.target.value === "__custom__") {
                setShowCustom(true);
              } else {
                setShowCustom(false);
                setFormat(e.target.value as ProxyFormat);
              }
            }}
            className="bg-dark-700 border border-dark-600 rounded px-2 py-1 text-xs"
          >
            {BUILTIN_FORMATS.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
            <option value="__custom__">{t("proxy.customFormat")}</option>
          </select>
        </div>

        {/* Custom format builder */}
        {showCustom && (
          <div className="bg-dark-700 border border-dark-600 rounded p-3 space-y-2">
            <p className="text-xs text-gray-400">{t("proxy.formatConstructor")}</p>
            <div className="flex items-center gap-1 flex-wrap">
              {customParts.map((part, i) =>
                i % 2 === 0 ? (
                  <select
                    key={i}
                    value={part}
                    onChange={(e) => updateCustomPart(i, e.target.value)}
                    className="bg-dark-600 border border-dark-500 rounded px-2 py-1 text-xs text-accent"
                  >
                    {CUSTOM_FIELDS.map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                ) : (
                  <select
                    key={i}
                    value={part}
                    onChange={(e) => updateCustomPart(i, e.target.value)}
                    className="bg-dark-600 border border-dark-500 rounded px-1 py-1 text-xs text-yellow-400 w-10 text-center"
                  >
                    {CUSTOM_SEPS.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                )
              )}
            </div>
            <p className="text-xs text-gray-500">{t("proxy.preview")} <span className="text-gray-300">{customPreview}</span></p>
          </div>
        )}
      </div>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-lg p-4 mb-2 text-center cursor-pointer transition-colors ${
          dragging ? "border-accent bg-accent/10" : "border-dark-500 hover:border-accent"
        }`}
      >
        <IconUpload size={24} className="mx-auto mb-1 text-gray-500" />
        <p className="text-xs text-gray-400">{t("proxy.dragFile")}</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".txt"
        className="hidden"
        onChange={handleFileSelect}
      />

      {/* Textarea */}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        placeholder={t("proxy.perLine", { format: showCustom ? customPreview : format })}
        className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm mb-2 resize-y"
      />
      <div className="flex gap-2 mb-3 flex-wrap">
        <button onClick={addProxies} className="btn-primary">{t("proxy.addBtn")}</button>
        <button onClick={checkAll} disabled={checking} className="btn-secondary">
          {checking ? t("proxy.checking") : t("proxy.checkAll")}
        </button>
        {proxies.length > 0 && (
          <button onClick={deleteAll} className="btn-danger text-xs">{t("proxy.deleteAllBtn")}</button>
        )}
      </div>
      {checkResult && <p className="text-xs text-gray-300 mb-3">{checkResult}</p>}
      {proxies.length > 0 && (() => {
        const alive = proxies.filter(p => p.is_alive).length;
        const dead = proxies.length - alive;
        return (
          <p className="text-xs text-gray-400 mb-3">
            <span className="text-green-400">● {alive}</span>
            <span className="mx-2">/</span>
            <span className="text-red-400">● {dead}</span>
            <span className="mx-2">/</span>
            <span>{proxies.length}</span>
          </p>
        );
      })()}
      <div className="max-h-48 overflow-y-auto space-y-1">
        {proxies.map((p) => (
          <div key={p.id} className="flex items-center justify-between text-xs gap-2 group px-2 py-1 rounded hover:bg-dark-700">
            <span className={`${p.is_alive ? "text-green-400" : "text-red-400"} min-w-0 truncate`}>
              {p.protocol}://{p.address}
            </span>
            <button
              onClick={() => deleteProxy(p.id)}
              className="text-red-400 hover:bg-red-400/20 rounded px-2 py-0.5 text-sm font-medium shrink-0 transition"
              title={t("proxy.deleteProxy")}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
