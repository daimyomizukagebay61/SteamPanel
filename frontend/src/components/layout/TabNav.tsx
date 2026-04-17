import { useUiStore } from "@/stores/uiStore";
import type { TabId } from "@/api/types";
import { IconUsers, IconFolderOpen, IconWrench, IconScrollText } from "@/components/shared/Icons";
import { useT } from "@/lib/i18n";

type IconComponent = typeof IconUsers;

const TAB_KEYS: { id: TabId; labelKey: string; icon: IconComponent }[] = [
  { id: "accounts", labelKey: "tab.accounts", icon: IconUsers },
  { id: "mafiles", labelKey: "tab.mafiles", icon: IconFolderOpen },
  { id: "tools", labelKey: "tab.tools", icon: IconWrench },
  { id: "logs", labelKey: "tab.logs", icon: IconScrollText },
];

export function TabNav() {
  const activeTab = useUiStore((s) => s.activeTab);
  const setTab = useUiStore((s) => s.setTab);
  const t = useT();

  return (
    <nav className="bg-dark-800 border-b border-dark-600 flex gap-1 px-4 overflow-x-auto">
      {TAB_KEYS.map(({ id, labelKey, icon: Icon }) => (
        <button
          key={id}
          onClick={() => setTab(id)}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
            activeTab === id
              ? "border-accent text-accent"
              : "border-transparent text-gray-400 hover:text-gray-200"
          }`}
        >
          <Icon size={14} />
          {t(labelKey)}
        </button>
      ))}
    </nav>
  );
}
