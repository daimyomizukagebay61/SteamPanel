import { create } from "zustand";
import type {
  TabId,
  Toast,
  ToastType,
  ColumnSettings,
  LogpassColumnSettings,
  TokenColumnSettings,
} from "@/api/types";
import { api } from "@/api/client";

let _toastId = 0;

const DEFAULT_COLUMNS: ColumnSettings = {
  browser: true,
  profile: true,
  steam_id: true,
  login: true,
  password: true,
  login_pass: true,
  email: true,
  email_pass: false,
  email_login_pass: false,
  phone: true,
  status: true,
  ban: true,
  twofa: true,
  mafile: true,
  proxy: true,
  notes: true,
  actions: true,
  last_online: true,
};

const DEFAULT_LOGPASS_COLUMNS: LogpassColumnSettings = {
  browser: true,
  profile: true,
  steam_id: true,
  login: true,
  password: true,
  login_pass: true,
  status: true,
  ban: true,
  prime: true,
  trophy: true,
  behavior: true,
  license: true,
  proxy: true,
  notes: true,
  actions: true,
  last_online: true,
};

const DEFAULT_TOKEN_COLUMNS: TokenColumnSettings = {
  browser: true,
  profile: true,
  last_online: true,
  steam_id: true,
  login: true,
  token: true,
  status: true,
  proxy: true,
  notes: true,
  actions: true,
};

interface UiState {
  activeTab: TabId;
  setTab: (tab: TabId) => void;
  accountSection: "mafile" | "logpass" | "token";
  setAccountSection: (s: "mafile" | "logpass" | "token") => void;
  toasts: Toast[];
  addToast: (type: ToastType, message: string) => void;
  removeToast: (id: number) => void;
  hidePasswords: boolean;
  setHidePasswords: (v: boolean) => void;
  loadDisplaySettings: () => Promise<void>;
  columnVisibility: ColumnSettings;
  setColumnVisibility: (v: ColumnSettings) => void;
  toggleColumn: (key: keyof ColumnSettings) => void;
  loadColumnSettings: () => Promise<void>;
  logpassColumnVisibility: LogpassColumnSettings;
  toggleLogpassColumn: (key: keyof LogpassColumnSettings) => void;
  loadLogpassColumnSettings: () => Promise<void>;
  autoProxyOnImport: boolean;
  autoValidateOnImport: boolean;
  autoProxyOnImportMafile: boolean;
  autoProxyOnImportLogpass: boolean;
  autoProxyOnImportToken: boolean;
  autoValidateOnImportMafile: boolean;
  autoValidateOnImportLogpass: boolean;
  autoValidateOnImportToken: boolean;
  loadImportSettings: () => Promise<void>;
  tokenColumnVisibility: TokenColumnSettings;
  toggleTokenColumn: (key: keyof TokenColumnSettings) => void;
  loadTokenColumnSettings: () => Promise<void>;
}

export const useUiStore = create<UiState>((set, get) => ({
  activeTab: "accounts",
  setTab: (tab) => set({ activeTab: tab }),
  accountSection: "mafile",
  setAccountSection: (s) => set({ accountSection: s }),
  toasts: [],
  addToast: (type, message) => {
    const id = ++_toastId;
    set((s) => ({ toasts: [...s.toasts, { id, type, message }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 4000);
  },
  removeToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  hidePasswords: false,
  setHidePasswords: (v) => {
    set({ hidePasswords: v });
    api.updateDisplaySettings({ hide_passwords: v }).catch(() => {});
  },
  loadDisplaySettings: async () => {
    try {
      const d = await api.getDisplaySettings();
      set({ hidePasswords: d.hide_passwords });
    } catch {
      /* ignore */
    }
  },

  columnVisibility: { ...DEFAULT_COLUMNS },
  setColumnVisibility: (v) => set({ columnVisibility: v }),
  toggleColumn: (key) => {
    const cols = {
      ...get().columnVisibility,
      [key]: !get().columnVisibility[key],
    };
    set({ columnVisibility: cols });
    api.updateColumnSettings(cols).catch(() => {});
  },
  loadColumnSettings: async () => {
    try {
      const c = await api.getColumnSettings();
      set({ columnVisibility: { ...DEFAULT_COLUMNS, ...c } });
    } catch {
      /* ignore */
    }
  },

  logpassColumnVisibility: { ...DEFAULT_LOGPASS_COLUMNS },
  toggleLogpassColumn: (key) => {
    const cols = {
      ...get().logpassColumnVisibility,
      [key]: !get().logpassColumnVisibility[key],
    };
    set({ logpassColumnVisibility: cols });
    api.updateLogpassColumnSettings(cols).catch(() => {});
  },
  loadLogpassColumnSettings: async () => {
    try {
      const c = await api.getLogpassColumnSettings();
      set({ logpassColumnVisibility: { ...DEFAULT_LOGPASS_COLUMNS, ...c } });
    } catch {
      /* ignore */
    }
  },

  autoProxyOnImport: false,
  autoValidateOnImport: false,
  autoProxyOnImportMafile: true,
  autoProxyOnImportLogpass: true,
  autoProxyOnImportToken: true,
  autoValidateOnImportMafile: true,
  autoValidateOnImportLogpass: true,
  autoValidateOnImportToken: true,
  loadImportSettings: async () => {
    try {
      const s = await api.getValidationSettings();
      set({
        autoProxyOnImport: s.auto_proxy_on_import,
        autoValidateOnImport: s.auto_validate_on_import,
        autoProxyOnImportMafile: s.auto_proxy_on_import_mafile,
        autoProxyOnImportLogpass: s.auto_proxy_on_import_logpass,
        autoProxyOnImportToken: s.auto_proxy_on_import_token,
        autoValidateOnImportMafile: s.auto_validate_on_import_mafile,
        autoValidateOnImportLogpass: s.auto_validate_on_import_logpass,
        autoValidateOnImportToken: s.auto_validate_on_import_token,
      });
    } catch {
      /* ignore */
    }
  },

  tokenColumnVisibility: { ...DEFAULT_TOKEN_COLUMNS },
  toggleTokenColumn: (key) => {
    const cols = {
      ...get().tokenColumnVisibility,
      [key]: !get().tokenColumnVisibility[key],
    };
    set({ tokenColumnVisibility: cols });
    api.updateTokenColumnSettings(cols).catch(() => {});
  },
  loadTokenColumnSettings: async () => {
    try {
      const c = await api.getTokenColumnSettings();
      set({ tokenColumnVisibility: { ...DEFAULT_TOKEN_COLUMNS, ...c } });
    } catch {
      /* ignore */
    }
  },
}));
