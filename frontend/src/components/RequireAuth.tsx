"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { storage, keys } from "@/lib/storage";
import { getCurrentUser } from "@/lib/auth/auth";

type Props = {
  mode: "saas" | "tenant";
  children: React.ReactNode;
};

export default function RequireAuth({ mode, children }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const tokenKey = mode === "saas" ? keys.saasAccessToken : keys.accessToken;
  const loginPath = mode === "saas" ? "/saas/login" : "/login";

  useEffect(() => {
    const token = storage.get(tokenKey);
    const savedMode = storage.get(keys.mode);

    // No token or wrong mode → redirect immediately
    if (!token || savedMode !== mode) {
      router.replace(loginPath);
      return;
    }

    // Validate token with backend
    getCurrentUser()
      .then(() => {
        setLoading(false);
      })
      .catch(() => {
        storage.remove(keys.accessToken);
        storage.remove(keys.saasAccessToken);
        storage.remove(keys.tenantId);
        storage.remove(keys.tenantSlug);
        storage.remove(keys.mode);

        router.replace(loginPath);
      });
  }, [loginPath, mode, router, tokenKey]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen text-sm text-gray-500">
        Checking session...
      </div>
    );
  }

  return <>{children}</>;
}
