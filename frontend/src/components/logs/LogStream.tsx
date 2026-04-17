import { useState, useEffect, useRef } from "react";
import type { LogEntry } from "@/api/types";
import { api } from "@/api/client";
import { useSSE } from "@/hooks/useSSE";

export function LogStream() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const autoScroll = useRef(true);

  useEffect(() => {
    api.getLogs().then(setLogs).catch(() => {});
  }, []);

  useSSE<LogEntry>("/api/logs/stream", (entry) => {
    setLogs((prev) => {
      const next = [...prev, entry];
      if (next.length > 500) next.splice(0, next.length - 500);
      return next;
    });
  });

  useEffect(() => {
    if (autoScroll.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs]);

  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    autoScroll.current = scrollHeight - scrollTop - clientHeight < 40;
  };

  const levelColor = (level: string): string => {
    switch (level) {
      case "error":
      case "critical": return "text-red-400";
      case "warning": return "text-yellow-400";
      case "success": return "text-green-400";
      case "debug": return "text-gray-500";
      default: return "text-gray-300";
    }
  };

  return (
    <div className="bg-dark-800 border border-dark-600 rounded-lg flex flex-col" style={{ maxHeight: 'calc(100vh - 200px)' }}>
      <div className="px-3 py-2 border-b border-dark-600 flex items-center justify-between shrink-0">
        <h3 className="font-semibold text-sm">📜 Лог</h3>
        <button
          onClick={() => setLogs([])}
          className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          Очистить
        </button>
      </div>
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto min-h-0 p-2 font-mono text-xs space-y-px"
      >
        {logs.map((entry, i) => (
          <div key={i} className="flex gap-2">
            <span className="text-gray-600 shrink-0">{entry.ts}</span>
            <span className={`shrink-0 w-3 text-center ${levelColor(entry.level)}`}>{entry.icon}</span>
            <span className={`${levelColor(entry.level)} break-all min-w-0`}>{entry.msg}</span>
          </div>
        ))}
        {logs.length === 0 && (
          <p className="text-gray-600 text-center py-4">Нет логов</p>
        )}
      </div>
    </div>
  );
}
