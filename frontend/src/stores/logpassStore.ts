import { create } from "zustand";
import type { LogpassAccount } from "@/api/types";
import { api } from "@/api/client";

interface LogpassState {
  accounts: LogpassAccount[];
  selectedIds: Set<number>;
  loading: boolean;

  loadAccounts: () => Promise<void>;
  toggleSelect: (id: number) => void;
  selectAll: () => void;
  clearSelection: () => void;
}

export const useLogpassStore = create<LogpassState>((set) => ({
  accounts: [],
  selectedIds: new Set(),
  loading: false,

  loadAccounts: async () => {
    set({ loading: true });
    try {
      const data = await api.getLogpassAccounts();
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
}));
