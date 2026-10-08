import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { can } from '@quack/shared';
import { EditorTabs } from '../components/EditorTabs';
import { InviteDialog } from '../components/InviteDialog';
import { FileTree } from '../components/FileTree';
import { Button, Empty, ErrorNote, Spinner } from '../components/ui';
import { useFileMutations, useFiles, useMe, useProject, useWorkspace } from '../lib/queries';
import { selectTabs, useTabs } from '../store/tabs';

// CodeMirror and Yjs are the heaviest part of the app, so they load only when a file is opened.
const CollabEditor = lazy(() => import('../components/CollabEditor').then((m) => ({ default: m.CollabEditor })));

export function ProjectPage() {
  const { projectId = '' } = useParams();
  const me = useMe();
  const project = useProject(projectId);
  const workspace = useWorkspace(project.data?.workspaceId ?? '');
  const files = useFiles(projectId);
  const { create, move, remove } = useFileMutations(projectId);
  const tabs = useTabs(selectTabs(projectId));
  const { openFile, closeFile, activate, prune } = useTabs.getState();
  const [inviteOpen, setInviteOpen] = useState(false);

  // Collaborators add and delete files too, so poll lightly and keep tabs consistent with the tree.
  useEffect(() => {
    const t = setInterval(() => void files.refetch(), 10_000);
    return () => clearInterval(t);
  }, [files]);
  const items = useMemo(() => files.data?.items ?? [], [files.data]);
  useEffect(() => {
    if (files.data) prune(projectId, new Set(items.map((f) => f.id)));
  }, [files.data, items, projectId, prune]);

  if (project.isPending || files.isPending) return <div className="p-6"><Spinner /></div>;
  if (project.error || files.error || !project.data || !me.data) {
    return <div className="mx-auto max-w-3xl p-6"><ErrorNote error={project.error ?? files.error ?? new Error('Not found')} /></div>;
  }

  const canWrite = can(workspace.data?.role, 'file:write');
  const activeFile = items.find((f) => f.id === tabs.active && f.kind === 'file');

  return (
    <div className="grid h-full grid-cols-1 grid-rows-[auto_1fr] md:grid-cols-[16rem_1fr] md:grid-rows-1">
      <aside aria-label="Project sidebar" className="flex max-h-56 min-h-0 flex-col border-b border-border bg-surface md:max-h-none md:border-b-0 md:border-r">
        <div className="border-b border-border px-3 py-2">
          <Link to={`/w/${project.data.workspaceId}`} className="text-xs text-muted underline">← {workspace.data?.name ?? 'Workspace'}</Link>
          <h1 className="truncate font-semibold">{project.data.name}</h1>
        </div>
        <div className="min-h-0 flex-1">
          <FileTree
            files={items}
            activeId={tabs.active}
            canWrite={canWrite}
            onOpen={(id) => {
              const f = items.find((x) => x.id === id);
              if (f?.kind === 'file') openFile(projectId, id);
            }}
            onCreate={async (path, kind) => {
              const f = await create.mutateAsync({ path, kind });
              if (kind === 'file') openFile(projectId, f.id);
            }}
            onUpload={(path, content) => create.mutateAsync({ path, kind: 'file', content })}
            onMove={(id, path) => move.mutateAsync({ id, path })}
            onDelete={(id) => remove.mutateAsync(id)}
          />
        </div>
      </aside>

      <section aria-label="Editor" className="flex min-h-0 min-w-0 flex-col">
        <EditorTabs
          files={items}
          open={tabs.open}
          active={tabs.active}
          onActivate={(id) => activate(projectId, id)}
          onClose={(id) => closeFile(projectId, id)}
          actions={
            can(workspace.data?.role, 'invite:create') && (
              <Button variant="ghost" className="!py-1 text-xs" onClick={() => setInviteOpen(true)} title="Invite people to this workspace">
                + Invite
              </Button>
            )
          }
        />
        <div id="editor-panel" role="tabpanel" aria-labelledby={activeFile ? `tab-${activeFile.id}` : undefined} className="min-h-0 flex-1">
          {activeFile ? (
            <Suspense fallback={<div className="p-4"><Spinner label="Loading editor" /></div>}>
              <CollabEditor key={activeFile.id} fileId={activeFile.id} path={activeFile.path} me={me.data} />
            </Suspense>
          ) : (
            <div className="grid h-full place-items-center p-6">
              <Empty title="Open a file to start editing">
                {canWrite ? 'Create a file in the sidebar, or pick one to open.' : 'Pick a file in the sidebar to read it.'}
              </Empty>
            </div>
          )}
        </div>
      </section>
      <InviteDialog workspaceId={project.data.workspaceId} open={inviteOpen} onOpenChange={setInviteOpen} />
    </div>
  );
}
