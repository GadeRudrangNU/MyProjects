import { useEffect, useRef } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Workspace } from '@quack/shared';
import { api } from '../lib/api';
import { keys } from '../lib/queries';
import { ErrorNote, Spinner } from '../components/ui';

export function InvitePage() {
  const { token = '' } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const started = useRef(false);
  const accept = useMutation({
    mutationFn: () => api<Workspace>('POST', `/invites/${token}/accept`),
    onSuccess: async (ws) => {
      await qc.invalidateQueries({ queryKey: keys.workspaces });
      nav(`/w/${ws.id}`, { replace: true });
    },
  });

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    accept.mutate();
  }, [accept]);

  return (
    <div className="mx-auto max-w-md space-y-4 p-8 text-center">
      {accept.error ? (
        <>
          <ErrorNote error={accept.error} />
          <Link to="/" className="text-sm underline">Back to your workspaces</Link>
        </>
      ) : (
        <Spinner label="Joining workspace" />
      )}
    </div>
  );
}
