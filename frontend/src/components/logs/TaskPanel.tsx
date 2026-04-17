import { useTaskStore } from "@/stores/taskStore";
import { usePolling } from "@/hooks/usePolling";
import { useUiStore } from "@/stores/uiStore";
import { api } from "@/api/client";

export function TaskPanel() {
  const tasks = useTaskStore((s) => s.tasks);
  const hasRunning = useTaskStore((s) => s.hasRunning);
  const loadTasks = useTaskStore((s) => s.loadTasks);
  const addToast = useUiStore((s) => s.addToast);

  // Bug #5: poll every 10s, pause when no running tasks
  usePolling(loadTasks, hasRunning ? 5_000 : 30_000);

  const cancelTask = async (id: string) => {
    try {
      await api.cancelTask(id);
      addToast("info", "Задача отменена");
      await loadTasks();
    } catch (e: unknown) {
      addToast("error", `Ошибка: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const statusColor = (status: string) => {
    switch (status) {
      case "running": return "text-blue-400";
      case "completed": return "text-green-400";
      case "failed": return "text-red-400";
      case "pending": return "text-yellow-400";
      default: return "text-gray-400";
    }
  };

  return (
    <div className="bg-dark-800 border border-dark-600 rounded-lg flex flex-col h-full min-h-[300px]">
      <div className="px-3 py-2 border-b border-dark-600">
        <h3 className="font-semibold text-sm">⚡ Активные задачи</h3>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {tasks.length === 0 ? (
          <p className="text-gray-600 text-center text-xs py-4">Нет задач</p>
        ) : (
          tasks.map((t) => (
            <div key={t.id} className="bg-dark-700 rounded p-2 text-xs">
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium">{t.type}</span>
                <span className={`text-xs ${statusColor(t.status)}`}>{t.status}</span>
              </div>
              {t.total > 0 && (
                <div className="progress-bar mb-1">
                  <div
                    className="progress-fill"
                    style={{ width: `${Math.round((t.progress / t.total) * 100)}%` }}
                  />
                </div>
              )}
              <div className="flex items-center justify-between text-gray-500">
                <span>{t.progress}/{t.total}</span>
                {(t.status === "running" || t.status === "pending") && (
                  <button onClick={() => cancelTask(t.id)} className="text-red-400 hover:underline">Отмена</button>
                )}
              </div>
              {t.result && <p className="text-green-400 mt-1">{t.result}</p>}
              {t.error && <p className="text-red-400 mt-1">{t.error}</p>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
