import { createContext, type ReactNode, useContext, useMemo } from "react";
import { api } from "./api";
import { usePolling } from "./hooks";
import type { Account, Page } from "./types";

type Ctx = { loaded: boolean; accounts: Account[]; byId: Record<string, Account>; refresh: () => Promise<void>; name: (id: string) => string };
const AccountsContext = createContext<Ctx>({ loaded: false, accounts: [], byId: {}, refresh: async () => {}, name: (id) => id.slice(0, 8) });

export function AccountsProvider({ children }: { children: ReactNode }) {
  const { data, refresh } = usePolling(() => api<Page<Account>>("/accounts", { params: { limit: 500 } }), 4000);
  const value = useMemo<Ctx>(() => {
    const accounts = data?.results ?? [];
    const byId = Object.fromEntries(accounts.map((a) => [a.id, a]));
    return { loaded: data !== undefined, accounts, byId, refresh, name: (id) => byId[id]?.name ?? id.slice(0, 8) };
  }, [data, refresh]);
  return <AccountsContext.Provider value={value}>{children}</AccountsContext.Provider>;
}

export const useAccounts = () => useContext(AccountsContext);
