"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Building2, KeyRound, Lock, RefreshCw } from "lucide-react";

import { AppShell, type AppNavItem } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import { api, apiFetchRaw } from "@/lib/api";
import { notifyTenantBrandingUpdated } from "@/lib/tenant-branding";

type TenantSettingsPageProps = {
  appTitle: string;
  nav: AppNavItem[];
  activeHref: string;
  roleContext: "director" | "secretary";
};

type DirectorUser = {
  id: string;
  email: string;
  full_name: string | null;
  is_active: boolean;
  roles: string[];
};

type PrintProfile = {
  school_header: string | null;
  logo_url: string | null;
};

const BADGE_MAX_BYTES = 2 * 1024 * 1024;

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeDirectorUsers(value: unknown): DirectorUser[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((raw) => {
      const row = asObject(raw);
      if (!row) return null;
      const id = asString(row.id);
      const email = asString(row.email);
      if (!id || !email) return null;
      const roles = Array.isArray(row.roles)
        ? row.roles
            .map((role) => asString(role).toUpperCase())
            .filter(Boolean)
        : [];
      return {
        id,
        email,
        full_name: asString(row.full_name) || null,
        is_active: row.is_active === false ? false : true,
        roles,
      } satisfies DirectorUser;
    })
    .filter((row): row is DirectorUser => Boolean(row));
}

function isStrongPassword(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length >= 8 && /[A-Za-z]/.test(trimmed) && /\d/.test(trimmed);
}

export function TenantSettingsPage({
  appTitle,
  nav,
  activeHref,
  roleContext,
}: TenantSettingsPageProps) {
  const [selfCurrentPassword, setSelfCurrentPassword] = useState("");
  const [selfNewPassword, setSelfNewPassword] = useState("");
  const [selfConfirmPassword, setSelfConfirmPassword] = useState("");
  const [savingSelfPassword, setSavingSelfPassword] = useState(false);

  const [secretaryUsers, setSecretaryUsers] = useState<DirectorUser[]>([]);
  const [selectedSecretaryId, setSelectedSecretaryId] = useState("");
  const [secretaryNewPassword, setSecretaryNewPassword] = useState("");
  const [secretaryConfirmPassword, setSecretaryConfirmPassword] = useState("");
  const [savingSecretaryPassword, setSavingSecretaryPassword] = useState(false);
  const [loadingSecretaries, setLoadingSecretaries] = useState(false);

  const [badgePreviewUrl, setBadgePreviewUrl] = useState<string | null>(null);
  const [badgeFile, setBadgeFile] = useState<File | null>(null);
  const [loadingBadge, setLoadingBadge] = useState(false);
  const [savingBadge, setSavingBadge] = useState(false);
  const [deletingBadge, setDeletingBadge] = useState(false);
  const badgeInputRef = useRef<HTMLInputElement | null>(null);

  const [printProfile, setPrintProfile] = useState<PrintProfile | null>(null);

  const isDirector = roleContext === "director";

  const revokeObjectUrl = useCallback((value: string | null) => {
    if (!value || !value.startsWith("blob:")) return;
    URL.revokeObjectURL(value);
  }, []);

  const replaceBadgePreviewUrl = useCallback(
    (next: string | null) => {
      setBadgePreviewUrl((prev) => {
        if (prev && prev !== next) revokeObjectUrl(prev);
        return next;
      });
    },
    [revokeObjectUrl]
  );

  // Load print profile for school name
  const loadPrintProfile = useCallback(async () => {
    try {
      const raw = await api.get<unknown>("/tenants/print-profile", {
        tenantRequired: true,
        noRedirect: true,
      });
      const obj = asObject(raw);
      if (obj) {
        setPrintProfile({
          school_header: asString(obj.school_header) || null,
          logo_url: asString(obj.logo_url) || null,
        });
      }
    } catch {
      // non-fatal — school name just won't show
    }
  }, []);

  useEffect(() => {
    void loadPrintProfile();
  }, [loadPrintProfile]);

  const loadSecretaries = useCallback(async () => {
    if (!isDirector) return;
    setLoadingSecretaries(true);
    try {
      const raw = await api.get<unknown>("/tenants/director/users?limit=300&offset=0", {
        tenantRequired: true,
        noRedirect: true,
      });
      const users = normalizeDirectorUsers(raw).filter(
        (row) => row.is_active && row.roles.includes("SECRETARY")
      );
      setSecretaryUsers(users);
      setSelectedSecretaryId((prev) => {
        if (prev && users.some((row) => row.id === prev)) return prev;
        return users[0]?.id || "";
      });
    } catch (error: unknown) {
      setSecretaryUsers([]);
      setSelectedSecretaryId("");
      const message =
        error instanceof Error ? error.message : "Unable to load tenant secretaries.";
      toast.error(message);
    } finally {
      setLoadingSecretaries(false);
    }
  }, [isDirector]);

  useEffect(() => {
    void loadSecretaries();
  }, [loadSecretaries]);

  const selectedSecretary = useMemo(
    () => secretaryUsers.find((row) => row.id === selectedSecretaryId) || null,
    [secretaryUsers, selectedSecretaryId]
  );

  const loadBadge = useCallback(async () => {
    setLoadingBadge(true);
    try {
      const response = await apiFetchRaw("/tenants/settings/badge", {
        method: "GET",
        tenantRequired: true,
        noRedirect: true,
      });
      const blob = await response.blob();
      if (!blob || blob.size === 0) {
        replaceBadgePreviewUrl(null);
        return;
      }
      replaceBadgePreviewUrl(URL.createObjectURL(blob));
    } catch {
      replaceBadgePreviewUrl(null);
    } finally {
      setLoadingBadge(false);
    }
  }, [replaceBadgePreviewUrl]);

  useEffect(() => {
    void loadBadge();
  }, [loadBadge]);

  useEffect(() => {
    return () => {
      revokeObjectUrl(badgePreviewUrl);
    };
  }, [badgePreviewUrl, revokeObjectUrl]);

  const onBadgeFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0] || null;
      if (!file) return;

      if (!file.type.startsWith("image/")) {
        toast.error("Please select an image file.");
        event.target.value = "";
        return;
      }
      if (file.size > BADGE_MAX_BYTES) {
        toast.error("School badge must be 2MB or smaller.");
        event.target.value = "";
        return;
      }

      setBadgeFile(file);
      replaceBadgePreviewUrl(URL.createObjectURL(file));
    },
    [replaceBadgePreviewUrl]
  );

  const uploadBadge = useCallback(async () => {
    if (!isDirector) return;
    if (!badgeFile) {
      toast.error("Please choose an image to upload.");
      return;
    }

    const payload = new FormData();
    payload.append("badge", badgeFile);

    setSavingBadge(true);
    try {
      await apiFetchRaw("/tenants/settings/badge", {
        method: "POST",
        body: payload,
        tenantRequired: true,
        noRedirect: true,
      });
      setBadgeFile(null);
      if (badgeInputRef.current) {
        badgeInputRef.current.value = "";
      }
      await loadBadge();
      notifyTenantBrandingUpdated();
      toast.success("School badge updated.");
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Unable to upload school badge.";
      toast.error(message);
    } finally {
      setSavingBadge(false);
    }
  }, [badgeFile, isDirector, loadBadge]);

  const deleteBadge = useCallback(async () => {
    if (!isDirector) return;

    setDeletingBadge(true);
    try {
      await api.delete("/tenants/settings/badge", undefined, {
        tenantRequired: true,
        noRedirect: true,
      });
      setBadgeFile(null);
      if (badgeInputRef.current) {
        badgeInputRef.current.value = "";
      }
      replaceBadgePreviewUrl(null);
      notifyTenantBrandingUpdated();
      toast.success("School badge removed.");
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Unable to remove school badge.";
      toast.error(message);
    } finally {
      setDeletingBadge(false);
    }
  }, [isDirector, replaceBadgePreviewUrl]);

  const resetSelfPassword = useCallback(async () => {
    if (!isDirector) return;
    if (selfNewPassword.trim() !== selfConfirmPassword.trim()) {
      toast.error("New password confirmation does not match.");
      return;
    }
    if (!isStrongPassword(selfNewPassword)) {
      toast.error("Password must be 8+ characters with at least one letter and one number.");
      return;
    }

    setSavingSelfPassword(true);
    try {
      await api.post(
        "/tenants/settings/password/self",
        {
          current_password: selfCurrentPassword.trim() || undefined,
          new_password: selfNewPassword.trim(),
        },
        {
          tenantRequired: true,
          noRedirect: true,
        }
      );
      setSelfCurrentPassword("");
      setSelfNewPassword("");
      setSelfConfirmPassword("");
      toast.success("Your password has been updated.");
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Unable to update your password.";
      toast.error(message);
    } finally {
      setSavingSelfPassword(false);
    }
  }, [isDirector, selfConfirmPassword, selfCurrentPassword, selfNewPassword]);

  const resetSecretaryPassword = useCallback(async () => {
    if (!isDirector) return;
    if (!selectedSecretaryId) {
      toast.error("Please select a secretary account.");
      return;
    }
    if (secretaryNewPassword.trim() !== secretaryConfirmPassword.trim()) {
      toast.error("Secretary password confirmation does not match.");
      return;
    }
    if (!isStrongPassword(secretaryNewPassword)) {
      toast.error("Password must be 8+ characters with at least one letter and one number.");
      return;
    }

    setSavingSecretaryPassword(true);
    try {
      await api.post(
        "/tenants/settings/password/secretary",
        {
          secretary_user_id: selectedSecretaryId,
          new_password: secretaryNewPassword.trim(),
        },
        {
          tenantRequired: true,
          noRedirect: true,
        }
      );
      setSecretaryNewPassword("");
      setSecretaryConfirmPassword("");
      toast.success("Secretary password reset completed.");
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Unable to reset secretary password.";
      toast.error(message);
    } finally {
      setSavingSecretaryPassword(false);
    }
  }, [isDirector, secretaryConfirmPassword, secretaryNewPassword, selectedSecretaryId]);

  const schoolName = printProfile?.school_header || null;

  return (
    <AppShell title={appTitle} nav={nav} activeHref={activeHref}>
      <div className="space-y-5">
        <div className="dashboard-hero rounded-[2rem] p-5 text-white shadow-sm">
          <h1 className="text-xl font-bold">Settings</h1>
          <p className="mt-1 text-sm text-blue-100">
            Manage tenant role-based security controls.
          </p>
        </div>

        {/* ── School Identity ─────────────────────────────────────────── */}
        <section className="dashboard-surface rounded-[1.6rem] p-5">
          <div className="mb-4 flex items-center gap-2">
            <Building2 className="h-4 w-4 text-slate-600" />
            <h2 className="text-sm font-semibold text-slate-900">School Identity</h2>
          </div>

          <div className="grid gap-6 md:grid-cols-[auto_1fr]">
            {/* Preview panel — mirrors the AppShell sidebar brand */}
            <div className="flex flex-col items-center gap-3">
              <div className="flex h-[120px] w-[200px] items-center justify-center overflow-hidden rounded-xl border border-[#e1d4c0] bg-white shadow-sm">
                {badgePreviewUrl ? (
                  <img
                    src={badgePreviewUrl}
                    alt="School badge preview"
                    className="h-full w-full object-contain p-2"
                  />
                ) : (
                  <div className="flex flex-col items-center gap-0.5 px-4 text-center">
                    {loadingBadge ? (
                      <span className="text-xs text-slate-400">Loading…</span>
                    ) : (
                      <>
                        <span className="text-[10px] uppercase tracking-wide text-[#7c4b24]">
                          Platform
                        </span>
                        <span className="text-sm font-semibold text-[#132129]">
                          {appTitle}
                        </span>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* School name beneath the badge preview */}
              <div className="flex w-[200px] items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <Building2 className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                {schoolName ? (
                  <span className="truncate text-xs font-medium text-slate-800">{schoolName}</span>
                ) : (
                  <span className="truncate text-xs text-slate-400 italic">School name not set</span>
                )}
              </div>

              <p className="w-[200px] text-center text-[10px] text-slate-400">
                Sidebar preview
              </p>
            </div>

            {/* Upload controls */}
            <div className="space-y-4">
              <div>
                <p className="mb-1 text-sm font-medium text-slate-700">
                  {schoolName ?? <span className="italic text-slate-400">School name not set</span>}
                </p>
                <p className="text-xs text-slate-500">
                  Upload a PNG, JPG, WEBP or GIF badge (max 2 MB) to replace the default
                  "Platform" label in the sidebar. The badge is stored server-side and shared
                  across all users of this tenant.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="school-badge-upload">Badge Image</Label>
                <Input
                  id="school-badge-upload"
                  ref={badgeInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={onBadgeFileChange}
                  disabled={!isDirector || savingBadge || deletingBadge}
                />
              </div>

              {isDirector ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    onClick={() => void uploadBadge()}
                    disabled={!badgeFile || savingBadge || deletingBadge}
                  >
                    {savingBadge ? "Uploading…" : "Save Badge"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void deleteBadge()}
                    disabled={!badgePreviewUrl || savingBadge || deletingBadge}
                  >
                    {deletingBadge ? "Removing…" : "Remove Badge"}
                  </Button>
                </div>
              ) : (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Only the director can update the school badge.
                </p>
              )}
            </div>
          </div>
        </section>

        {/* ── Password & Security ──────────────────────────────────────── */}
        <section className="dashboard-surface rounded-[1.6rem] p-5">
          <div className="mb-4 flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-slate-600" />
            <h2 className="text-sm font-semibold text-slate-900">Password & Security</h2>
          </div>

          {!isDirector ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              Secretary accounts cannot reset passwords from settings.
              Contact the director to update credentials.
            </div>
          ) : (
            <div className="space-y-5">
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="mb-3 flex items-center gap-2">
                  <Lock className="h-4 w-4 text-slate-600" />
                  <h3 className="text-sm font-semibold text-slate-900">Director Password</h3>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="self-current-password">Current Password (optional)</Label>
                    <PasswordInput
                      id="self-current-password"
                      value={selfCurrentPassword}
                      onChange={(event) => setSelfCurrentPassword(event.target.value)}
                      placeholder="Enter current password"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="self-new-password">New Password</Label>
                    <PasswordInput
                      id="self-new-password"
                      value={selfNewPassword}
                      onChange={(event) => setSelfNewPassword(event.target.value)}
                      placeholder="8+ chars, letters + numbers"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="self-confirm-password">Confirm Password</Label>
                    <PasswordInput
                      id="self-confirm-password"
                      value={selfConfirmPassword}
                      onChange={(event) => setSelfConfirmPassword(event.target.value)}
                      placeholder="Re-enter new password"
                    />
                  </div>
                </div>
                <div className="mt-3">
                  <Button onClick={() => void resetSelfPassword()} disabled={savingSelfPassword}>
                    {savingSelfPassword ? "Updating..." : "Update My Password"}
                  </Button>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Secretary Password Reset
                  </h3>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void loadSecretaries()}
                    disabled={loadingSecretaries}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Refresh List
                  </Button>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="secretary-select">Secretary Account</Label>
                    <Select
                      value={selectedSecretaryId || "__none__"}
                      onValueChange={(value) =>
                        setSelectedSecretaryId(value === "__none__" ? "" : value)
                      }
                    >
                      <SelectTrigger id="secretary-select">
                        <SelectValue placeholder="Select secretary" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Select secretary</SelectItem>
                        {secretaryUsers.map((row) => (
                          <SelectItem key={row.id} value={row.id}>
                            {row.full_name || row.email}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-slate-500">
                      {selectedSecretary ? selectedSecretary.email : "No secretary selected"}
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="secretary-new-password">New Password</Label>
                    <PasswordInput
                      id="secretary-new-password"
                      value={secretaryNewPassword}
                      onChange={(event) => setSecretaryNewPassword(event.target.value)}
                      placeholder="8+ chars, letters + numbers"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="secretary-confirm-password">Confirm Password</Label>
                    <PasswordInput
                      id="secretary-confirm-password"
                      value={secretaryConfirmPassword}
                      onChange={(event) => setSecretaryConfirmPassword(event.target.value)}
                      placeholder="Re-enter new password"
                    />
                  </div>
                </div>

                <div className="mt-3">
                  <Button
                    onClick={() => void resetSecretaryPassword()}
                    disabled={savingSecretaryPassword || !selectedSecretaryId}
                    variant="destructive"
                  >
                    {savingSecretaryPassword ? "Resetting..." : "Reset Secretary Password"}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
