import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

interface ProjectTabs {
  open: string[];
  active: string | null;
}

interface TabsState {
  byProject: Record<string, ProjectTabs>;
  openFile: (projectId: string, fileId: string) => void;
  closeFile: (projectId: string, fileId: string) => void;
  activate: (projectId: string, fileId: string) => void;
  /** Drops tabs for files that no longer exist (deleted by anyone). */
  prune: (projectId: string, validIds: Set<string>) => void;
}

const EMPTY: ProjectTabs = { open: [], active: null };
export const selectTabs = (projectId: string) => (s: TabsState) => s.byProject[projectId] ?? EMPTY;

function neighbour(open: string[], closing: string): string | null {
  const i = open.indexOf(closing);
  const rest = open.filter((id) => id !== closing);
  return rest[Math.min(i, rest.length - 1)] ?? null;
}

// localStorage can throw or be unavailable (private windows, blocked site data); the app must work without it.
const safeStorage: StateStorage = {
  getItem: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  setItem: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* ignore */
    }
  },
  removeItem: (k) => {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  },
};

export const useTabs = create<TabsState>()(
  persist(
    (set) => ({
      byProject: {},
      openFile: (projectId, fileId) =>
        set((s) => {
          const cur = s.byProject[projectId] ?? EMPTY;
          const open = cur.open.includes(fileId) ? cur.open : [...cur.open, fileId];
          return { byProject: { ...s.byProject, [projectId]: { open, active: fileId } } };
        }),
      closeFile: (projectId, fileId) =>
        set((s) => {
          const cur = s.byProject[projectId] ?? EMPTY;
          const active = cur.active === fileId ? neighbour(cur.open, fileId) : cur.active;
          return {
            byProject: { ...s.byProject, [projectId]: { open: cur.open.filter((id) => id !== fileId), active } },
          };
        }),
      activate: (projectId, fileId) =>
        set((s) => ({
          byProject: { ...s.byProject, [projectId]: { ...(s.byProject[projectId] ?? EMPTY), active: fileId } },
        })),
      prune: (projectId, validIds) =>
        set((s) => {
          const cur = s.byProject[projectId];
          if (!cur || cur.open.every((id) => validIds.has(id))) return s;
          const open = cur.open.filter((id) => validIds.has(id));
          const active = cur.active && validIds.has(cur.active) ? cur.active : (open.at(-1) ?? null);
          return { byProject: { ...s.byProject, [projectId]: { open, active } } };
        }),
    }),
    { name: 'quack:tabs', storage: createJSONStorage(() => safeStorage), partialize: (s) => ({ byProject: s.byProject }) },
  ),
);
