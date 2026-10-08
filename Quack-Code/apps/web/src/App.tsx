import { useEffect, useState } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useMe } from './lib/queries';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/Login';
import { HomePage } from './pages/Home';
import { WorkspacePage } from './pages/Workspace';
import { ProjectPage } from './pages/Project';
import { InvitePage } from './pages/Invite';

/** Free hosting sleeps when idle; show a friendly screen instead of a blank page while it wakes. */
function WakingUp() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <main className="grid min-h-full place-items-center p-6 text-center">
      <div role="status" className="max-w-sm space-y-3">
        <div aria-hidden className="mx-auto size-10 animate-spin rounded-full border-4 border-border border-t-accent-bg" />
        <h1 className="text-xl font-semibold">Waking up the server…</h1>
        <p className="text-sm text-muted">
          Quack-Code runs on free hosting that sleeps when idle. The first visit can take up to a minute ({seconds}s so far).
        </p>
      </div>
    </main>
  );
}

function AuthGate() {
  const me = useMe();
  const location = useLocation();
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (!me.isPending) return setSlow(false);
    const t = setTimeout(() => setSlow(true), 2500);
    return () => clearTimeout(t);
  }, [me.isPending]);

  useEffect(() => {
    if (!me.isError) return;
    const t = setTimeout(() => void me.refetch(), 3000);
    return () => clearTimeout(t);
  }, [me.isError, me.errorUpdatedAt, me]);

  if (me.isError || (me.isPending && slow)) return <WakingUp />;
  if (me.isPending) return <div className="min-h-full" aria-busy="true" />;
  if (!me.data) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return (
    <Layout user={me.data}>
      <Outlet />
    </Layout>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<AuthGate />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/w/:workspaceId" element={<WorkspacePage />} />
        <Route path="/p/:projectId" element={<ProjectPage />} />
        <Route path="/invite/:token" element={<InvitePage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
