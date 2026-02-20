"use client";

import { useState } from "react";

import { AppShell } from "@/components/layout/AppShell";
import { directorNav } from "@/components/layout/nav-config";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function TenantRbacPage() {
  const [userId, setUserId] = useState("");
  const [permissionCode, setPermissionCode] = useState("");
  const [effect, setEffect] = useState<"ALLOW" | "DENY">("ALLOW");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function saveOverride() {
    setBusy(true);
    setMessage(null);
    setError(null);

    const res = await fetch("/api/tenant/director/rbac/overrides", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: userId.trim(),
        permission_code: permissionCode.trim(),
        effect,
      }),
    });

    const data = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) {
      setError(typeof data?.detail === "string" ? data.detail : "Failed to save override");
      return;
    }

    setMessage("Permission override saved.");
  }

  async function deleteOverride() {
    setBusy(true);
    setMessage(null);
    setError(null);

    const res = await fetch("/api/tenant/director/rbac/overrides", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: userId.trim(),
        permission_code: permissionCode.trim(),
      }),
    });

    const data = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) {
      setError(typeof data?.detail === "string" ? data.detail : "Failed to delete override");
      return;
    }

    setMessage("Permission override deleted.");
  }

  return (
    <AppShell title="Director" nav={directorNav} activeHref="/tenant/rbac">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">RBAC Controls</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Apply tenant-scoped permission overrides for emergency access control.
          </p>
        </div>

        {error && <div className="text-sm text-destructive">{error}</div>}
        {message && <div className="text-sm text-emerald-600">{message}</div>}

        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle className="text-base">Permission Override Action Panel</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 max-w-xl">
            <div className="space-y-2">
              <Label>User ID</Label>
              <Input placeholder="UUID" value={userId} onChange={(e) => setUserId(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>Permission Code</Label>
              <Input
                placeholder="e.g. finance.invoices.manage"
                value={permissionCode}
                onChange={(e) => setPermissionCode(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Effect</Label>
              <Select value={effect} onValueChange={(v: "ALLOW" | "DENY") => setEffect(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALLOW">ALLOW</SelectItem>
                  <SelectItem value="DENY">DENY</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-2">
              <Button onClick={saveOverride} disabled={busy || !userId.trim() || !permissionCode.trim()}>
                {busy ? "Working..." : "Save Override"}
              </Button>
              <Button variant="outline" onClick={deleteOverride} disabled={busy || !userId.trim() || !permissionCode.trim()}>
                Delete Override
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
