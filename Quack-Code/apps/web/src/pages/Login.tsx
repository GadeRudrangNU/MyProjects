import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useMe } from '../lib/queries';
import { Button, ErrorNote, Field } from '../components/ui';

export function LoginPage() {
  const me = useMe();
  const nav = useNavigate();
  const qc = useQueryClient();
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/';
  const [name, setName] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  if (me.data) return <Navigate to={from} replace />;

  const devLogin = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('POST', '/auth/dev-login', { name });
      await qc.invalidateQueries({ queryKey: ['me'] });
      nav(from, { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="grid min-h-full place-items-center p-6">
      <div className="w-full max-w-sm space-y-6 rounded-xl border border-border bg-surface p-6">
        <div className="space-y-1 text-center">
          <div aria-hidden className="text-4xl">🦆</div>
          <h1 className="text-2xl font-bold">Quack-Code</h1>
          <p className="text-sm text-muted">Write code together, in real time.</p>
        </div>
        <a
          href="/api/v1/auth/github"
          className="flex w-full items-center justify-center rounded-md bg-accent-bg px-3 py-2 text-sm font-semibold text-accent-text hover:brightness-95"
        >
          Continue with GitHub
        </a>
        {import.meta.env.DEV && (
          <form onSubmit={devLogin} className="space-y-3 border-t border-border pt-4">
            <p className="text-xs text-muted">Development only: sign in without GitHub.</p>
            <Field label="Display name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} />
            {error != null && <ErrorNote error={error} />}
            <Button type="submit" disabled={busy || !name.trim()} className="w-full">
              Dev sign in
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}
