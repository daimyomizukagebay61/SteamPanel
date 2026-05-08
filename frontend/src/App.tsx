import { useEffect } from "react";
import { useUiStore } from "@/stores/uiStore";
import { Header } from "@/components/layout/Header";
import { TabNav } from "@/components/layout/TabNav";
import { ToastContainer } from "@/components/layout/Toast";
import { AccountsTab } from "@/components/accounts/AccountsTab";
import { ToolsTab } from "@/components/tools/ToolsTab";
import { MafileTab } from "@/components/mafiles/MafileTab";
import { LogsTab } from "@/components/logs/LogsTab";

export default function App() {
  const activeTab = useUiStore((s) => s.activeTab);
  const loadDisplaySettings = useUiStore((s) => s.loadDisplaySettings);
  const loadColumnSettings = useUiStore((s) => s.loadColumnSettings);
  const loadLogpassColumnSettings = useUiStore(
    (s) => s.loadLogpassColumnSettings,
  );
  const loadImportSettings = useUiStore((s) => s.loadImportSettings);

  useEffect(() => {
    loadDisplaySettings();
    loadColumnSettings();
    loadLogpassColumnSettings();
    loadImportSettings();
  }, []);

  return (
    <div className="h-dvh bg-dark-900 text-gray-300 flex flex-col overflow-hidden">
      <Header />
      <TabNav />
      <main className="flex-1 min-h-0 p-4 w-full overflow-y-auto">
        {activeTab === "accounts" && <AccountsTab />}
        {activeTab === "tools" && <ToolsTab />}
        {activeTab === "mafiles" && <MafileTab />}
        {activeTab === "logs" && <LogsTab />}
      </main>
      <ToastContainer />
    </div>
  );
}
