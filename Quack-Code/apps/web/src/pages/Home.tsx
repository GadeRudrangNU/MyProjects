import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCreateWorkspace, useWorkspaces } from '../lib/queries';
import { Button, Empty, ErrorNote, Field, Modal, Spinner } from '../components/ui';

export function HomePage() {
  const { data, isPending, error } = useWorkspaces();
  const create = useCreateWorkspace();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const ws = await create.mutateAsync(name);
    setOpen(false);
    setName('');
    nav(`/w/${ws.id}`);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Your workspaces</h1>
        <Button variant="primary" onClick={() => setOpen(true)}>
          New workspace
        </Button>
      </div>

      {isPending && <Spinner />}
      {error && <ErrorNote error={error} />}
      {data && data.items.length === 0 && (
        <Empty title="No workspaces yet">Create one to start a project, or open an invite link from a teammate.</Empty>
      )}
      <ul className="grid gap-3 sm:grid-cols-2">
        {data?.items.map((w) => (
          <li key={w.id}>
            <Link
              to={`/w/${w.id}`}
              className="block rounded-lg border border-border bg-surface p-4 hover:border-accent"
            >
              <span className="block font-semibold">{w.name}</span>
              <span className="text-sm capitalize text-muted">{w.role}</span>
            </Link>
          </li>
        ))}
      </ul>

      <Modal open={open} onOpenChange={setOpen} title="New workspace" description="A workspace groups projects and teammates.">
        <form onSubmit={submit} className="space-y-4">
          <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} autoFocus />
          {create.error && <ErrorNote error={create.error} />}
          <div className="flex justify-end gap-2">
            <Button type="button" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={create.isPending || !name.trim()}>
              Create
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
