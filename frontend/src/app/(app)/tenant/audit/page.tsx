"use client";

import { useEffect, useState } from "react";
import { Line, LineChart, CartesianGrid, XAxis } from "recharts";

import { AppShell } from "@/components/layout/AppShell";
import { directorNav } from "@/components/layout/nav-config";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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

type AuditRow = {
  id: string;
  action: string;
  resource: string;
  created_at: string;
};

const chartConfig = {
  events: { label: "Events", color: "hsl(var(--chart-1))" },
};

function toHourBucket(iso: string) {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "unknown";
  return `${dt.getUTCHours().toString().padStart(2, "0")}:00`;
}

export default function TenantAuditPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [action, setAction] = useState("");
  const [resource, setResource] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const qs = new URLSearchParams({ limit: "100", offset: "0" });
    if (action.trim()) qs.set("action", action.trim());
    if (resource.trim()) qs.set("resource", resource.trim());

    const res = await fetch(`/api/tenant/director/audit?${qs.toString()}`, { method: "GET" });
    const data = await res.json().catch(() => []);

    if (!res.ok) {
      setRows([]);
      setError("Failed to load audit logs");
      return;
    }

    setRows(Array.isArray(data) ? data : []);
    setError(null);
  }

  useEffect(() => {
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, []);

  const trendMap = rows.reduce((acc, row) => {
    const bucket = toHourBucket(row.created_at);
    acc[bucket] = (acc[bucket] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const trend = Object.entries(trendMap)
    .map(([hour, events]) => ({ hour, events }))
    .sort((a, b) => (a.hour > b.hour ? 1 : -1));

  return (
    <AppShell title="Director" nav={directorNav} activeHref="/tenant/audit">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Audit Monitoring</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Real-time tenant audit stream and operational traceability.
          </p>
        </div>

        {error && <div className="text-sm text-destructive">{error}</div>}

        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle className="text-base">Audit Filter Action Panel</CardTitle>
          </CardHeader>
          <CardContent className="flex gap-2 flex-col sm:flex-row">
            <Input placeholder="Action (e.g. enrollment.approve)" value={action} onChange={(e) => setAction(e.target.value)} />
            <Input placeholder="Resource (e.g. finance.invoice)" value={resource} onChange={(e) => setResource(e.target.value)} />
            <Button onClick={load}>Apply</Button>
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle className="text-base">Audit Volume Trend (Live)</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[260px] w-full">
              <LineChart data={trend} accessibilityLayer>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="hour" tickLine={false} axisLine={false} tickMargin={8} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line type="monotone" dataKey="events" stroke="var(--color-events)" strokeWidth={2} dot={false} />
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle className="text-base">Recent Audit Logs</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Action</TableHead>
                  <TableHead>Resource</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>ID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.slice(0, 30).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell><Badge variant="secondary">{r.action}</Badge></TableCell>
                    <TableCell>{r.resource}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.id}</TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-sm text-muted-foreground">
                      No audit logs found.
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
