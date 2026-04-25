import type {
  Account, AccountCreate, AccountUpdate, BulkImportResult,
  Proxy, Task, MafileInfo, MafileExportRequest,
  ActionRequest, ValidationSettings, DisplaySettings, ColumnSettings, LogpassColumnSettings, LogEntry,
  LogpassAccount, LogpassAccountCreate, LogpassAccountUpdate,
  TokenAccount, TokenAccountCreate, TokenColumnSettings,
} from "./types";

const BASE = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(body.detail ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  // Version
  getVersion: () => request<{ version: string }>("/version"),

  // Accounts
  getAccounts: () => request<Account[]>("/accounts"),
  getAccount: (id: number) => request<Account>(`/accounts/${id}`),
  createAccount: (data: AccountCreate) =>
    request<Account>("/accounts", { method: "POST", body: JSON.stringify(data) }),
  updateAccount: (id: number, data: AccountUpdate) =>
    request<Account>(`/accounts/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteAccount: (id: number) =>
    request<void>(`/accounts/${id}`, { method: "DELETE" }),
  deleteBulk: (ids: number[]) =>
    request<{ deleted: number }>("/accounts/delete-bulk", { method: "POST", body: JSON.stringify({ ids }) }),
  assignProxies: () =>
    request<{ assigned: number; proxies_used: number }>("/accounts/assign-proxies", { method: "POST" }),
  reassignProxies: () =>
    request<{ assigned: number; proxies_used: number }>("/accounts/reassign-proxies", { method: "POST" }),
  clearProxies: () =>
    request<{ cleared: number }>("/accounts/clear-proxies", { method: "POST" }),
  importAccounts: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return fetch(`${BASE}/accounts/import`, { method: "POST", body: form }).then(async (r) => {
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail ?? r.statusText);
      return r.json() as Promise<BulkImportResult>;
    });
  },

  // Actions
  executeAction: (data: ActionRequest) =>
    request<{ task_id: string; accounts_count: number }>("/actions", { method: "POST", body: JSON.stringify(data) }),
  respondToPrompt: (taskId: string, value: string, login?: string) =>
    request<{ status: string }>(`/tasks/${taskId}/respond`, { method: "POST", body: JSON.stringify({ value, login: login || "" }) }),
  generate2FA: (shared_secret: string) =>
    request<{ code: string }>("/actions/generate-2fa", { method: "POST", body: JSON.stringify({ shared_secret }) }),
  generate2FAByAccount: (account_id: number) =>
    request<{ code: string }>("/actions/generate-2fa-by-account", { method: "POST", body: JSON.stringify({ account_id }) }),
  getConfirmations: (account_id: number) =>
    request<{ success: boolean; confirmations: import("./types").SteamConfirmation[] }>(`/actions/confirmations/${account_id}`),
  respondConfirmations: (account_id: number, ids: string[], nonces: string[], accept: boolean) =>
    request<{ success: boolean }>(`/actions/confirmations/${account_id}/respond`, {
      method: "POST",
      body: JSON.stringify({ ids, nonces, accept }),
    }),

  // Proxies
  getProxies: () => request<Proxy[]>("/proxies"),
  addProxy: (address: string, protocol = "http") =>
    request<Proxy>("/proxies", { method: "POST", body: JSON.stringify({ address, protocol }) }),
  deleteProxy: (id: number) =>
    request<void>(`/proxies/${id}`, { method: "DELETE" }),
  deleteAllProxies: () =>
    request<{ deleted: number }>("/proxies/all", { method: "DELETE" }),
  bulkAddProxies: (proxies: { address: string; protocol: string }[]) =>
    request<{ added: number }>("/proxies/bulk", { method: "POST", body: JSON.stringify(proxies) }),
  checkProxies: () =>
    request<{ total: number; alive: number; dead: number }>("/proxies/check", { method: "POST" }),

  // Tasks
  getTasks: () => request<Task[]>("/tasks"),
  getTask: (id: string) => request<Task>(`/tasks/${id}`),
  cancelTask: (id: string) => request<void>(`/tasks/${id}`, { method: "DELETE" }),

  // Mafiles
  getMafiles: () => request<MafileInfo[]>("/mafiles"),
  uploadMafiles: (files: File[]) => {
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    return fetch(`${BASE}/mafiles/upload`, { method: "POST", body: form }).then(async (r) => {
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail ?? r.statusText);
      return r.json() as Promise<{ uploaded: number; errors: string[] }>;
    });
  },
  deleteMafile: (filename: string) =>
    request<void>(`/mafiles/${encodeURIComponent(filename)}`, { method: "DELETE" }),
  exportSecrets: () => request<{ account_name: string; shared_secret: string; identity_secret: string; steam_id: string }[]>("/mafiles/export/all"),
  exportZip: (body: MafileExportRequest) =>
    fetch(`${BASE}/mafiles/export/zip`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => {
      if (!r.ok) throw new Error(`Export failed: ${r.status}`);
      return r.blob();
    }),

  // Settings
  getValidationSettings: () => request<ValidationSettings>("/settings/validation"),
  updateValidationSettings: (data: ValidationSettings) =>
    request<ValidationSettings>("/settings/validation", { method: "PUT", body: JSON.stringify(data) }),
  getDisplaySettings: () => request<DisplaySettings>("/settings/display"),
  updateDisplaySettings: (data: DisplaySettings) =>
    request<DisplaySettings>("/settings/display", { method: "PUT", body: JSON.stringify(data) }),
  getColumnSettings: () => request<ColumnSettings>("/settings/columns"),
  updateColumnSettings: (data: ColumnSettings) =>
    request<ColumnSettings>("/settings/columns", { method: "PUT", body: JSON.stringify(data) }),
  getLogpassColumnSettings: () => request<LogpassColumnSettings>("/settings/logpass-columns"),
  updateLogpassColumnSettings: (data: LogpassColumnSettings) =>
    request<LogpassColumnSettings>("/settings/logpass-columns", { method: "PUT", body: JSON.stringify(data) }),

  // Logs
  getLogs: () => request<LogEntry[]>("/logs"),

  // Auto-accept
  startAutoAccept: (ids: number[]) =>
    request<{ started: number[] }>("/auto-accept/start", { method: "POST", body: JSON.stringify({ account_ids: ids }) }),
  stopAutoAccept: (ids: number[]) =>
    request<{ stopped: number[] }>("/auto-accept/stop", { method: "POST", body: JSON.stringify({ account_ids: ids }) }),
  getAutoAcceptStatus: () =>
    request<{ running: number[] }>("/auto-accept/status"),

  // Browser
  openBrowser: (id: number) =>
    request<{ status: string; message: string; task_id?: string }>(`/accounts/${id}/browser`, { method: "POST" }),

  // Logpass accounts
  getLogpassAccounts: () => request<LogpassAccount[]>("/logpass"),
  createLogpassAccount: (data: LogpassAccountCreate) =>
    request<LogpassAccount>("/logpass", { method: "POST", body: JSON.stringify(data) }),
  updateLogpassAccount: (id: number, data: LogpassAccountUpdate) =>
    request<LogpassAccount>(`/logpass/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteLogpassAccount: (id: number) =>
    request<void>(`/logpass/${id}`, { method: "DELETE" }),
  deleteLogpassBulk: (ids: number[]) =>
    request<{ deleted: number }>("/logpass/delete-bulk", { method: "POST", body: JSON.stringify({ ids }) }),
  importLogpass: (lines: string[]) =>
    request<BulkImportResult>("/logpass/import", { method: "POST", body: JSON.stringify({ lines }) }),
  validateLogpass: (account_ids: number[]) =>
    request<{ task_id: string; accounts_count: number }>("/logpass/validate", { method: "POST", body: JSON.stringify({ account_ids }) }),
  fullParseLogpass: (account_ids: number[]) =>
    request<{ task_id: string; accounts_count: number }>("/logpass/full-parse", { method: "POST", body: JSON.stringify({ account_ids }) }),
  assignLogpassProxies: () =>
    request<{ assigned: number; proxies_used: number }>("/logpass/assign-proxies", { method: "POST" }),
  reassignLogpassProxies: () =>
    request<{ assigned: number; proxies_used: number }>("/logpass/reassign-proxies", { method: "POST" }),
  clearLogpassProxies: () =>
    request<{ cleared: number }>("/logpass/clear-proxies", { method: "POST" }),
  openLogpassBrowser: (id: number) =>
    request<{ status: string; message: string; task_id?: string }>(`/logpass/${id}/browser`, { method: "POST" }),

  // Token accounts
  getTokenAccounts: () => request<TokenAccount[]>("/token-accounts"),
  createTokenAccount: (data: TokenAccountCreate) =>
    request<TokenAccount>("/token-accounts", { method: "POST", body: JSON.stringify(data) }),
  deleteTokenAccount: (id: number) =>
    request<void>(`/token-accounts/${id}`, { method: "DELETE" }),
  deleteTokenBulk: (ids: number[]) =>
    request<{ deleted: number }>("/token-accounts/delete-bulk", { method: "POST", body: JSON.stringify({ ids }) }),
  importTokens: (lines: string[]) =>
    request<BulkImportResult>("/token-accounts/import", { method: "POST", body: JSON.stringify({ lines }) }),
  validateTokens: (ids: number[]) =>
    request<{ task_id: string; accounts_count: number }>("/token-accounts/validate", { method: "POST", body: JSON.stringify({ account_ids: ids }) }),
  openTokenBrowser: (id: number) =>
    request<{ status: string; message: string; task_id?: string }>(`/token-accounts/${id}/browser`, { method: "POST" }),
  assignTokenProxies: () =>
    request<{ assigned: number; proxies_used: number }>("/token-accounts/assign-proxies", { method: "POST" }),
  reassignTokenProxies: () =>
    request<{ assigned: number; proxies_used: number }>("/token-accounts/reassign-proxies", { method: "POST" }),
  clearTokenProxies: () =>
    request<{ cleared: number }>("/token-accounts/clear-proxies", { method: "POST" }),
  getTokenColumnSettings: () => request<TokenColumnSettings>("/settings/token-columns"),
  updateTokenColumnSettings: (data: TokenColumnSettings) =>
    request<TokenColumnSettings>("/settings/token-columns", { method: "PUT", body: JSON.stringify(data) }),
};
