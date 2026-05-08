export interface Account {
  id: number;
  login: string;
  password: string;
  steam_id: string | null;
  email: string | null;
  email_password: string | null;
  phone: string | null;
  mafile_path: string | null;
  shared_secret: string | null;
  identity_secret: string | null;
  proxy: string | null;
  status: string;
  notes: string | null;
  nickname: string | null;
  avatar_url: string | null;
  steam_level: number | null;
  last_online: string | null;
  auto_accept: number;
  ban_status: string | null;
  has_cookies: boolean;
  has_revocation_code: boolean;
  created_at: string;
  updated_at: string;
}

export interface AccountCreate {
  login: string;
  password: string;
  steam_id?: string;
  email?: string;
  email_password?: string;
  phone?: string;
  proxy?: string;
  notes?: string;
}

export interface AccountUpdate {
  login?: string;
  password?: string;
  steam_id?: string;
  email?: string;
  email_password?: string;
  phone?: string;
  proxy?: string;
  status?: string;
  notes?: string;
}

export interface Proxy {
  id: number;
  address: string;
  protocol: string;
  is_alive: boolean;
  last_checked: string | null;
  fail_count: number;
}

export interface Task {
  id: string;
  type: string;
  status: string;
  progress: number;
  total: number;
  result: string | null;
  error: string | null;
  prompt?: string;
  prompt_login?: string;
  step?: number;
  total_steps?: number;
  step_label?: string;
  active_count?: number;
  account_ids?: string | null;
  account_results?:
    | Record<string, { status: string; error?: string }>
    | string
    | null;
  account_steps?: Record<string, { step: number; total: number }>;
  created_at: string;
  updated_at: string;
}

export interface MafileInfo {
  filename: string;
  account_name: string;
  steam_id: string;
  has_shared_secret: boolean;
  has_identity_secret: boolean;
  fully_enrolled: boolean;
  error?: string;
}

export interface MafileExportRequest {
  fields: string[];
  session_fields: string[];
  format: "flat_mafiles" | "per_account_folder" | "single_file";
  account_ids: number[];
  folder_name_template: string;
  mafile_name_template: string;
  txt_name_template: string;
  include_txt_per_folder: boolean;
  include_global_txt: boolean;
  skip_folders: boolean;
  txt_format: string;
}

export interface BulkImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

export interface ActionRequest {
  account_ids: number[];
  action: string;
  params?: Record<string, unknown>;
}

export interface ValidationSettings {
  fetch_profile: boolean;
  check_ban: boolean;
  max_threads: number;
  auto_revalidate_browser: boolean;
  auto_proxy_on_import: boolean;
  auto_validate_on_import: boolean;
  auto_proxy_on_import_mafile: boolean;
  auto_proxy_on_import_logpass: boolean;
  auto_proxy_on_import_token: boolean;
  auto_validate_on_import_mafile: boolean;
  auto_validate_on_import_logpass: boolean;
  auto_validate_on_import_token: boolean;
}

export interface DisplaySettings {
  hide_passwords: boolean;
}

export interface ColumnSettings {
  browser: boolean;
  profile: boolean;
  steam_id: boolean;
  login: boolean;
  password: boolean;
  login_pass: boolean;
  email: boolean;
  email_pass: boolean;
  email_login_pass: boolean;
  phone: boolean;
  status: boolean;
  ban: boolean;
  twofa: boolean;
  mafile: boolean;
  proxy: boolean;
  notes: boolean;
  actions: boolean;
  last_online: boolean;
}

export interface LogpassColumnSettings {
  browser: boolean;
  profile: boolean;
  steam_id: boolean;
  login: boolean;
  password: boolean;
  login_pass: boolean;
  status: boolean;
  ban: boolean;
  prime: boolean;
  trophy: boolean;
  behavior: boolean;
  license: boolean;
  proxy: boolean;
  notes: boolean;
  actions: boolean;
  last_online: boolean;
}

export interface TokenColumnSettings {
  browser: boolean;
  profile: boolean;
  last_online: boolean;
  steam_id: boolean;
  login: boolean;
  token: boolean;
  status: boolean;
  proxy: boolean;
  notes: boolean;
  actions: boolean;
}

export interface LogEntry {
  ts: string;
  level: string;
  icon: string;
  msg: string;
}

export interface LogpassAccount {
  id: number;
  login: string;
  password: string;
  steam_id: string | null;
  proxy: string | null;
  status: string;
  ban_status: string | null;
  nickname: string | null;
  steam_level: number | null;
  prime: string | null;
  trophy: string | null;
  behavior: string | null;
  license: string | null;
  notes: string | null;
  avatar_url: string | null;
  last_online: string | null;
  has_cookies: boolean;
  created_at: string;
  updated_at: string;
}

export interface LogpassAccountCreate {
  login: string;
  password: string;
  steam_id?: string;
  proxy?: string;
  notes?: string;
}

export interface LogpassAccountUpdate {
  login?: string;
  password?: string;
  steam_id?: string;
  proxy?: string;
  status?: string;
  notes?: string;
}

export interface TokenAccount {
  id: number;
  login: string | null;
  token: string;
  steam_id: string | null;
  proxy: string | null;
  status: string;
  ban_status: string | null;
  nickname: string | null;
  steam_level: number | null;
  avatar_url: string | null;
  last_online: string | null;
  has_cookies: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface TokenAccountCreate {
  login?: string;
  token: string;
  steam_id?: string;
  proxy?: string;
  notes?: string;
}

export type TabId = "accounts" | "tools" | "mafiles" | "logs";

export type ToastType = "info" | "success" | "error" | "warn";

export interface Toast {
  id: number;
  type: ToastType;
  message: string;
}

export interface TokenCheckData {
  steam_id: string | null;
  display_name: string | null;
  avatar_url: string | null;
  steam_level: number | null;
  last_online: string | null;
  balance_raw: string | null;
  user_country: string | null;
  family_group: boolean;
  playtime_2weeks: number;
  inventory_cs2: number;
  inventory_dota2: number;
  inventory_tf2: number;
  inventory_rust: number;
  inventory_cs2_marketable: number;
  inventory_dota2_marketable: number;
  inventory_tf2_marketable: number;
  inventory_rust_marketable: number;
  trade_ban: string | null;
  created_date: string | null;
  phone_digits: string | null;
  alert_status: string;
  market_limited: boolean;
  checked_at: string | null;
}

export interface SteamConfirmation {
  id: string;
  nonce: string;
  type: number;
  type_name: string;
  creator_id: string;
  headline: string;
  summary: string[];
  accept: string;
  cancel: string;
  icon: string;
}
