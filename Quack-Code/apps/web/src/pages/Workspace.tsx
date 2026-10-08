import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { can } from '@quack/shared';
import { api } from '../lib/api';
import {
  useCreateProject,
  useMe,
  useMembers,
  useProjects,
  useRemoveMember,
  useUpdateMember,
  useWorkspace,
} from '../lib/queries';
import { InviteDialog } from '../components/InviteDialog';
import { Button, Empty, ErrorNote, Field, Modal, Spinner } from '../components/ui';

export function WorkspacePage() {
  const { workspaceId = '' } = useParams();
  const ws = useWorkspace(workspaceId);
  const projects = useProjects(workspaceId);
  const members = useMembers(workspaceId);
  const me = useMe();
  const createProject = useCreateProject(workspaceId);
  const updateMember = useUpdateMember(workspaceId);
  const removeMember = useRemoveMember(workspaceId);
  const nav = useNavigate();

  const [projectOpen, setProjectOpen] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);

  if (ws.isPending) return <div className="p-6"><Spinner /></div>;
  if (ws.error) return <div className="mx-auto max-w-3xl p-6"><ErrorNote error={ws.error} /></div>;
  const role = ws.data.role;
  const isOwner = can(role, 'member:manage');

  const addProject = async (e: FormEvent) => {
    e.preventDefault();
    const p = await createProject.mutateAsync(projectName);
    setProjectOpen(false);
    setProjectName('');
    nav(`/p/${p.id}`);
  };

  const deleteWorkspace = async () => {
    if (!confirm(`Delete “${ws.data.name}” and everything in it? This cannot be undone.`)) return;
    await api('DELETE', `/workspaces/${workspaceId}`);
    nav('/');
  };

  return (
    <div className="mx-auto max-w-3xl space-y-10 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{ws.data.name}</h1>
          <p className="text-sm capitalize text-muted">Your role: {role}</p>
        </div>
        {isOwner && (
          <Button variant="danger" onClick={deleteWorkspace}>
            Delete workspace
          </Button>
        )}
      </div>

      <section aria-labelledby="projects-h" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 id="projects-h" className="text-lg font-semibold">Projects</h2>
          {can(role, 'project:create') && (
            <Button variant="primary" onClick={() => setProjectOpen(true)}>New project</Button>
          )}
        </div>
        {projects.isPending && <Spinner />}
        {projects.error && <ErrorNote error={projects.error} />}
        {projects.data?.items.length === 0 && <Empty title="No projects yet" />}
        <ul className="space-y-2">
          {projects.data?.items.map((p) => (
            <li key={p.id}>
              <Link to={`/p/${p.id}`} className="block rounded-lg border border-border bg-surface px-4 py-3 font-medium hover:border-accent">
                {p.name}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="members-h" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 id="members-h" className="text-lg font-semibold">Members</h2>
          {can(role, 'invite:create') && (
            <Button onClick={() => setInviteOpen(true)}>Invite people</Button>
          )}
        </div>
        {members.isPending && <Spinner />}
        {members.error && <ErrorNote error={members.error} />}
        {(updateMember.error || removeMember.error) && <ErrorNote error={updateMember.error ?? removeMember.error} />}
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {members.data?.items.map((m) => {
            const self = m.user.id === me.data?.id;
            return (
              <li key={m.user.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <span>
                  {m.user.name} {self && <span className="text-sm text-muted">(you)</span>}
                </span>
                <span className="flex items-center gap-2">
                  {isOwner && m.role !== 'owner' ? (
                    <>
                      <label className="sr-only" htmlFor={`role-${m.user.id}`}>Role for {m.user.name}</label>
                      <select
                        id={`role-${m.user.id}`}
                        value={m.role}
                        onChange={(e) => updateMember.mutate({ userId: m.user.id, role: e.target.value as 'editor' | 'viewer' })}
                        className="rounded-md border border-border bg-surface px-2 py-1 text-sm"
                      >
                        <option value="editor">Editor</option>
                        <option value="viewer">Viewer</option>
                      </select>
                      <Button variant="ghost" onClick={() => removeMember.mutate(m.user.id)} aria-label={`Remove ${m.user.name}`}>
                        Remove
                      </Button>
                    </>
                  ) : (
                    <span className="text-sm capitalize text-muted">{m.role}</span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <Modal open={projectOpen} onOpenChange={setProjectOpen} title="New project">
        <form onSubmit={addProject} className="space-y-4">
          <Field label="Name" value={projectName} onChange={(e) => setProjectName(e.target.value)} required maxLength={60} autoFocus />
          {createProject.error && <ErrorNote error={createProject.error} />}
          <div className="flex justify-end gap-2">
            <Button type="button" onClick={() => setProjectOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={createProject.isPending || !projectName.trim()}>Create</Button>
          </div>
        </form>
      </Modal>

      <InviteDialog workspaceId={workspaceId} open={inviteOpen} onOpenChange={setInviteOpen} />
    </div>
  );
}
