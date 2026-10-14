import { KeyRound } from "lucide-react";
import { useState } from "react";
import { api, ApiError, getApiKey, setApiKey } from "../api";

export function LoginPage({ onConnected }: { onConnected: () => void }) {
  const [key, setKey] = useState(getApiKey());
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const connect = async () => {
    setBusy(true);
    setError(undefined);
    setApiKey(key.trim());
    try {
      await api("/me");
      onConnected();
    } catch (e) {
      setApiKey(null);
      setError(e instanceof ApiError && e.status === 401 ? "That API key was not recognised." : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="card login-card" onSubmit={(e) => { e.preventDefault(); void connect(); }}>
        <div className="brand"><span className="brand-mark"><svg width="18" height="18" viewBox="0 0 32 32"><path d="M6 21c4 0 4-10 8-10s4 10 8 10 3-6 4-6" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" /></svg></span> PayFlow</div>
        <div>
          <h1 style={{ fontSize: 21, letterSpacing: "-0.01em" }}>Connect to your PayFlow API</h1>
          <p className="muted" style={{ marginTop: 6 }}>Paste an API key. For a local demo run <span className="mono">python manage.py seed_demo</span> in <span className="mono">backend/</span> and use the key it prints.</p>
        </div>
        {error && <div className="alert bad" role="alert">{error}</div>}
        <label className="field">API key
          <input className="input mono" type="password" autoFocus autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="pf_test_…" />
        </label>
        <button className="btn primary" style={{ justifyContent: "center" }} disabled={!key.trim() || busy}><KeyRound size={16} /> {busy ? "Connecting…" : "Connect"}</button>
      </form>
    </div>
  );
}
