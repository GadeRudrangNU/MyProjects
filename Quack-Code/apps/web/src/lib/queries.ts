import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FileNode, Member, Project, User, Workspace } from '@quack/shared';
import { api, ApiError } from './api';

type Page<T> = { items: T[]; nextCursor: string | null };
type Role = 'editor' | 'viewer';

export const keys = {
  me: ['me'] as const,
  workspaces: ['workspaces'] as const,
  workspace: (id: string) => ['workspace', id] as const,
  members: (id: string) => ['members', id] as const,
  projects: (wsId: string) => ['projects', wsId] as const,
  project: (id: string) => ['project', id] as const,
  files: (projectId: string) => ['files', projectId] as const,
};

export const useMe = () =>
  useQuery({
    queryKey: keys.me,
    queryFn: async () => {
      try {
        return await api<User>('GET', '/me');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    retry: false,
    staleTime: 60_000,
  });

export const useWorkspaces = () =>
  useQuery({ queryKey: keys.workspaces, queryFn: () => api<Page<Workspace>>('GET', '/workspaces?limit=100') });

export const useWorkspace = (id: string) =>
  useQuery({ queryKey: keys.workspace(id), queryFn: () => api<Workspace>('GET', `/workspaces/${id}`), enabled: !!id });

export const useMembers = (id: string) =>
  useQuery({ queryKey: keys.members(id), queryFn: () => api<{ items: Member[] }>('GET', `/workspaces/${id}/members`), enabled: !!id });

export const useProjects = (wsId: string) =>
  useQuery({ queryKey: keys.projects(wsId), queryFn: () => api<{ items: Project[] }>('GET', `/workspaces/${wsId}/projects`), enabled: !!wsId });

export const useProject = (id: string) =>
  useQuery({ queryKey: keys.project(id), queryFn: () => api<Project>('GET', `/projects/${id}`), enabled: !!id });

export const useFiles = (projectId: string) =>
  useQuery({ queryKey: keys.files(projectId), queryFn: () => api<{ items: FileNode[] }>('GET', `/projects/${projectId}/files`), enabled: !!projectId });

export function useCreateWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api<Workspace>('POST', '/workspaces', { name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.workspaces }),
  });
}

export function useCreateProject(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api<Project>('POST', `/workspaces/${wsId}/projects`, { name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.projects(wsId) }),
  });
}

export function useUpdateMember(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { userId: string; role: Role }) => api<Member>('PATCH', `/workspaces/${wsId}/members/${v.userId}`, { role: v.role }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.members(wsId) }),
  });
}

export function useRemoveMember(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api('DELETE', `/workspaces/${wsId}/members/${userId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.members(wsId) }),
  });
}

export function useCreateInvite(wsId: string) {
  return useMutation({
    mutationFn: (v: { role: Role; expiresInHours: number; maxUses: number }) =>
      api<{ token: string; expiresAt: string; maxUses: number }>('POST', `/workspaces/${wsId}/invites`, v),
  });
}

export function useFileMutations(projectId: string) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: keys.files(projectId) });
  return {
    create: useMutation({
      mutationFn: (v: { path: string; kind: 'file' | 'folder'; content?: string }) => api<FileNode>('POST', `/projects/${projectId}/files`, v),
      onSuccess: refresh,
    }),
    move: useMutation({
      mutationFn: (v: { id: string; path: string }) => api<FileNode>('PATCH', `/files/${v.id}`, { path: v.path }),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api('DELETE', `/files/${id}`),
      onSuccess: refresh,
    }),
  };
}
