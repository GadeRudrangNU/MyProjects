import { useState } from "react";
import { getActor, setActor } from "./api";
import { AuditPage } from "./components/AuditPage";
import { FlagPage } from "./components/FlagPage";
import { FlagsPage } from "./components/FlagsPage";
import { ProposalBanner } from "./components/ProposalBanner";
import { useHash } from "./useHash";

export function App() {
  const hash = useHash();
  const [actor, setActorName] = useState(getActor);

  const flagMatch = hash.match(/^\/flags\/(.+)$/);
  const onAudit = hash === "/audit";

  return (
    <>
      <header className="topbar">
        <a className="brand" href="#/">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" width="20" height="20">
              <path d="M9 17l5 5 9-12" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          ShipSafe
        </a>
        <nav aria-label="Primary">
          <a href="#/" aria-current={!onAudit ? "page" : undefined}>Flags</a>
          <a href="#/audit" aria-current={onAudit ? "page" : undefined}>Audit log</a>
        </nav>
        <label className="actor">
          <span>Acting as</span>
          <input
            value={actor}
            maxLength={64}
            aria-label="Acting as"
            onChange={(event) => {
              setActorName(event.target.value);
              setActor(event.target.value);
            }}
          />
        </label>
      </header>
      <main>
        <ProposalBanner />
        {onAudit ? (
          <AuditPage />
        ) : flagMatch ? (
          <FlagPage flagKey={decodeURIComponent(flagMatch[1]!)} />
        ) : (
          <FlagsPage />
        )}
      </main>
    </>
  );
}
