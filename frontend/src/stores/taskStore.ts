import { create } from "zustand";
import type { Task } from "@/api/types";
import { api } from "@/api/client";

interface TaskState {
  tasks: Task[];
  hasRunning: boolean;
  loadTasks: () => Promise<void>;
}

export const useTaskStore = create<TaskState>((set) => ({
  tasks: [],
  hasRunning: false,
  loadTasks: async () => {
    const data = await api.getTasks();
    set({
      tasks: data,
      hasRunning: data.some((t) => t.status === "running" || t.status === "pending"),
    });
  },
}));
