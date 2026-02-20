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

  useEffect(() => {
    const token = storage.get(keys.accessToken);
    const savedMode = storage.get(keys.mode);

    // No token or wrong mode → redirect immediately
    if (!token || savedMode !== mode) {
      router.replace(mode === "saas" ? "/saas/login" : "/tenant/login");
      return;
    }

    // Validate token with backend
    getCurrentUser()
      .then(() => {
        setLoading(false);
      })
      .catch(() => {
        storage.remove(keys.accessToken);
        storage.remove(keys.tenantSlug);
        storage.remove(keys.mode);

        router.replace(mode === "saas" ? "/saas/login" : "/tenant/login");
      });
  }, [mode, router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen text-sm text-gray-500">
        Checking session...
      </div>
    );
  }

  return <>{children}</>;
}
