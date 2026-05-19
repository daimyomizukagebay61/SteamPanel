import { TwoFAGenerator } from "./TwoFAGenerator";
import { ProxyManager } from "./ProxyManager";
import { ValidationSettings } from "./ValidationSettings";

export function ToolsTab() {
  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ValidationSettings />
        <ProxyManager />
      </div>
      <TwoFAGenerator />
    </div>
  );
}
