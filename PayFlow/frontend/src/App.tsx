import { BookOpen, FileCheck2, Landmark, LayoutDashboard, LogOut, Plus, ReceiptText, ShieldAlert, Webhook } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { BrowserRouter, NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AccountsProvider } from "./accounts-context";
import { api, checkHealth, getApiKey, setApiKey } from "./api";
import { NewPaymentModal } from "./components/NewPaymentModal";
import { ToastProvider } from "./components/ui";
import { usePolling } from "./hooks";
import { AccountsPage } from "./pages/Accounts";
import { FraudReviewPage } from "./pages/FraudReview";
import { LoginPage } from "./pages/Login";
import { OverviewPage } from "./pages/Overview";
import { ReconciliationPage } from "./pages/Reconciliation";
import { TransactionsPage } from "./pages/Transactions";
import { WebhooksPage } from "./pages/Webhooks";
import type { Overview } from "./types";

const TITLES: Record<string, string> = {
  "/": "Overview",
  "/transactions": "Transactions",
  "/accounts": "Accounts & balances",
  "/fraud": "Fraud review queue",
  "/reconciliation": "Reconciliation & settlement",
  "/webhooks": "Webhooks",
};

function Shell({ onLogout }: { onLogout: () => void }) {
  const location = useLocation();
  const [creating, setCreating] = useState(false);
  const me = usePolling(() => api<{ name: string; key_prefix: string }>("/me"), 0);
  const health = usePolling(checkHealth, 5000);
  const overview = usePolling(() => api<Overview>("/stats/overview"), 3000);
  const open = overview.data?.open_reviews ?? 0;
  const apiDocs = `${(import.meta.env.VITE_API_URL as string | undefined) ?? ""}/api/docs/`;

  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Main">
        <div className="brand">
          <span className="brand-mark"><svg width="18" height="18" viewBox="0 0 32 32"><path d="M6 21c4 0 4-10 8-10s4 10 8 10 3-6 4-6" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" /></svg></span>
          <span className="text">PayFlow</span>
        </div>
        <NavLink to="/" end className="nav-link"><LayoutDashboard size={18} /> Overview</NavLink>
        <NavLink to="/transactions" className="nav-link"><ReceiptText size={18} /> Transactions</NavLink>
        <NavLink to="/accounts" className="nav-link"><Landmark size={18} /> Accounts</NavLink>
        <NavLink to="/fraud" className="nav-link"><ShieldAlert size={18} /> Fraud review {open > 0 && <span className="pill">{open}</span>}</NavLink>
        <NavLink to="/reconciliation" className="nav-link"><FileCheck2 size={18} /> Reconciliation</NavLink>
        <NavLink to="/webhooks" className="nav-link"><Webhook size={18} /> Webhooks</NavLink>
        <a className="nav-link" href={apiDocs} target="_blank" rel="noreferrer"><BookOpen size={18} /> API docs</a>
        <div className="sidebar-foot">
          <div><b style={{ color: "#fff" }}>{me.data?.name ?? "…"}</b><div className="mono">{me.data?.key_prefix}…</div></div>
          <button className="nav-link" style={{ background: "none", border: 0, padding: "6px 0", width: "100%" }} onClick={onLogout}><LogOut size={16} /> Disconnect</button>
        </div>
      </nav>
      <div className="main">
        <header className="topbar">
          <h1>{TITLES[location.pathname] ?? "PayFlow"}</h1>
          <span className="grow" />
          <span className="live" title="API health"><span className={`dot ${health.data === false ? "bad" : "ok"}`} /> {health.data === false ? "API unreachable" : "API healthy"}</span>
          <button className="btn primary" onClick={() => setCreating(true)}><Plus size={16} /> New payment</button>
        </header>
        <main className="content">
          <Routes>
            <Route path="/" element={<OverviewPage />} />
            <Route path="/transactions" element={<TransactionsPage />} />
            <Route path="/accounts" element={<AccountsPage />} />
            <Route path="/fraud" element={<FraudReviewPage />} />
            <Route path="/reconciliation" element={<ReconciliationPage />} />
            <Route path="/webhooks" element={<WebhooksPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
      {creating && <NewPaymentModal onClose={() => setCreating(false)} onDone={() => void overview.refresh()} />}
    </div>
  );
}

export default function App() {
  const [connected, setConnected] = useState(Boolean(getApiKey()));
  const logout = useCallback(() => { setApiKey(null); setConnected(false); }, []);

  // A 401 anywhere means the key is wrong or revoked: send the user back to the connect screen.
  useEffect(() => {
    if (!connected) return;
    api("/me").catch((e) => { if (e?.status === 401) logout(); });
  }, [connected, logout]);

  return (
    <ToastProvider>
      {connected ? (
        <BrowserRouter>
          <AccountsProvider><Shell onLogout={logout} /></AccountsProvider>
        </BrowserRouter>
      ) : (
        <LoginPage onConnected={() => setConnected(true)} />
      )}
    </ToastProvider>
  );
}
