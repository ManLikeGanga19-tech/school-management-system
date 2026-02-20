"use client";

import { useEffect, useState } from "react";
import { Pie, PieChart, Cell } from "recharts";

import { AppShell } from "@/components/layout/AppShell";
import { directorNav } from "@/components/layout/nav-config";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";

type TenantUser = {
  id: string;
  email: string;
  full_name?: string | null;
  is_active: boolean;
};

const chartConfig = {
  active: { label: "Active", color: "hsl(var(--chart-2))" },
  inactive: { label: "Inactive", color: "hsl(var(--chart-4))" },
};

const COLORS = ["var(--color-active)", "var(--color-inactive)"];

export default function TenantUsersPage() {
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState("");
  const [roleCode, setRoleCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await fetch("/api/tenant/director/users", { method: "GET" });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      setUsers([]);
      setError("Failed to load users");
      return;
    }

    setUsers(Array.isArray(data?.users) ? data.users : []);
    setError(null);
  }

  useEffect(() => {
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, []);

  async function runRoleAction(mode: "assign" | "remove") {
    if (!userId.trim() || !roleCode.trim()) return;

    setBusy(true);
    const res = await fetch("/api/tenant/director/users/roles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode,
        user_id: userId.trim(),
        role_code: roleCode.trim(),
      }),
    });

    const data = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) {
      setError(typeof data?.detail === "string" ? data.detail : "Role action failed");
      return;
    }

    setError(null);
    setRoleCode("");
    setUserId("");
    await load();
  }

  const activeCount = users.filter((u) => u.is_active).length;
  const inactiveCount = users.length - activeCount;

  const pieData = [
    { name: "active", value: activeCount },
    { name: "inactive", value: inactiveCount },
  ];

  return (
    <AppShell title="Director" nav={directorNav} activeHref="/tenant/users">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">User & Role Operations</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage tenant users and role assignments with live state updates.
          </p>
        </div>

        {error && <div className="text-sm text-destructive">{error}</div>}

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="rounded-2xl">
            <CardHeader>
              <CardTitle className="text-base">Role Assignment Action Panel</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <Label>User ID</Label>
                <Input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="UUID" />
              </div>

              <div className="space-y-2">
                <Label>Role Code</Label>
                <Input value={roleCode} onChange={(e) => setRoleCode(e.target.value)} placeholder="DIRECTOR / SECRETARY" />
              </div>

              <div className="flex gap-2">
                <Button onClick={() => runRoleAction("assign")} disabled={busy}>
                  {busy ? "Working..." : "Assign Role"}
                </Button>
                <Button variant="outline" onClick={() => runRoleAction("remove")} disabled={busy}>
                  Remove Role
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl">
            <CardHeader>
              <CardTitle className="text-base">User Activity Trend (Live)</CardTitle>
            </CardHeader>
            <CardContent>
              <ChartContainer config={chartConfig} className="h-[260px] w-full">
                <PieChart>
                  <ChartTooltip content={<ChartTooltipContent nameKey="name" />} />
                  <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={95}>
                    {pieData.map((entry, index) => (
                      <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                </PieChart>
              </ChartContainer>
            </CardContent>
          </Card>
        </div>

        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle className="text-base">Tenant Users</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>ID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>{u.full_name || "-"}</TableCell>
                    <TableCell>{u.email}</TableCell>
                    <TableCell>
                      <Badge variant={u.is_active ? "default" : "secondary"}>
                        {u.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{u.id}</TableCell>
                  </TableRow>
                ))}
                {users.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-sm text-muted-foreground">
                      No users found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
