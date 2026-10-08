import { useState, type FormEvent } from 'react';
import { useCreateInvite } from '../lib/queries';
import { Button, ErrorNote, Field, Modal } from './ui';

/** Creates an invite link for a workspace. Used from the workspace page and from the editor window. */
export function InviteDialog({
  workspaceId,
  open,
  onOpenChange,
}: {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createInvite = useCreateInvite(workspaceId);
  const [role, setRole] = useState<'editor' | 'viewer'>('editor');
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setLink(null);
      setCopied(false);
      createInvite.reset();
    }
    onOpenChange(next);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const inv = await createInvite.mutateAsync({ role, expiresInHours: 72, maxUses: 10 });
    setLink(`${location.origin}/invite/${inv.token}`);
    setCopied(false);
  };

  return (
    <Modal
      open={open}
      onOpenChange={handleOpenChange}
      title="Invite people"
      description="The link expires in 3 days and works for up to 10 people. Anyone with it can join, so share it carefully."
    >
      {link ? (
        <div className="space-y-3">
          <Field label="Invite link" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
          <div className="flex justify-end gap-2">
            <Button
              variant="primary"
              onClick={async () => {
                await navigator.clipboard.writeText(link);
                setCopied(true);
              }}
            >
              {copied ? 'Copied' : 'Copy link'}
            </Button>
          </div>
          <p role="status" className="sr-only">{copied ? 'Invite link copied' : ''}</p>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="invite-role" className="block text-sm font-medium">Role</label>
            <select
              id="invite-role"
              value={role}
              onChange={(e) => setRole(e.target.value as 'editor' | 'viewer')}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
            >
              <option value="editor">Editor: can edit files</option>
              <option value="viewer">Viewer: read, comment and run only</option>
            </select>
          </div>
          {createInvite.error && <ErrorNote error={createInvite.error} />}
          <div className="flex justify-end gap-2">
            <Button type="button" onClick={() => handleOpenChange(false)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={createInvite.isPending}>Create link</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
