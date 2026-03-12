"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type ProspectAccount = {
  id: string;
  email: string;
  full_name: string;
  organization_name: string;
  phone?: string | null;
  job_title?: string | null;
  is_active: boolean;
};

type ProspectSessionContextValue = {
  account: ProspectAccount | null;
  loading: boolean;
  refresh: () => Promise<void>;
  setAccount: (account: ProspectAccount | null) => void;
};

const ProspectSessionContext = createContext<ProspectSessionContextValue | null>(null);

export function ProspectSessionProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState<ProspectAccount | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/prospect/auth/me", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });

      if (!res.ok) {
        setAccount(null);
        return;
      }

      const data = await res.json().catch(() => ({}));
      setAccount((data?.account as ProspectAccount | undefined) || null);
    } catch {
      setAccount(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({
      account,
      loading,
      refresh,
      setAccount,
    }),
    [account, loading, refresh]
  );

  return (
    <ProspectSessionContext.Provider value={value}>
      {children}
    </ProspectSessionContext.Provider>
  );
}

export function useProspectSession() {
  const context = useContext(ProspectSessionContext);
  if (!context) {
    throw new Error("useProspectSession must be used within ProspectSessionProvider");
  }
  return context;
}
