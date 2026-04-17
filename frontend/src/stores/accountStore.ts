import { create } from "zustand";
import type { Account } from "@/api/types";
import { api } from "@/api/client";

interface AccountState {
  accounts: Account[];
  selectedIds: Set<number>;
  loading: boolean;

  loadAccounts: () => Promise<void>;
  toggleSelect: (id: number) => void;
  selectAll: () => void;
  clearSelection: () => void;
  setSelectedIds: (ids: Set<number>) => void;

  /** IDs of accounts explicitly sent to the Mafile Manager tab */
  mafileManagerIds: Set<number>;
  sendToMafileManager: (ids: number[]) => void;
  clearMafileManager: () => void;
}

export const useAccountStore = create<AccountState>((set) => ({
  accounts: [],
  selectedIds: new Set(),
  loading: false,

  loadAccounts: async () => {
    set({ loading: true });
    try {
      const data = await api.getAccounts();
      set({ accounts: data });
    } finally {
      set({ loading: false });
    }
  },

  toggleSelect: (id) =>
    set((s) => {
      const next = new Set(s.selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selectedIds: next };
    }),

  selectAll: () =>
    set((s) => ({ selectedIds: new Set(s.accounts.map((a) => a.id)) })),

  clearSelection: () => set({ selectedIds: new Set() }),
  setSelectedIds: (ids) => set({ selectedIds: ids }),

  mafileManagerIds: new Set(),
  sendToMafileManager: (ids) =>
    set((s) => {
      const next = new Set(s.mafileManagerIds);
      ids.forEach((id) => next.add(id));
      return { mafileManagerIds: next };
    }),
  clearMafileManager: () => set({ mafileManagerIds: new Set() }),
}));
