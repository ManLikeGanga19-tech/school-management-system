export function normalizeRoleCode(role: string | null | undefined): string {
  return String(role ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
}

export function buildRoleCodeSet(
  roles: Array<string | null | undefined> | undefined
): Set<string> {
  return new Set((roles || []).map((role) => normalizeRoleCode(role)).filter(Boolean));
}

export function hasDirectorRole(roles: Array<string | null | undefined> | undefined): boolean {
  const codes = buildRoleCodeSet(roles);
  return codes.has("DIRECTOR");
}

export function hasSecretaryRole(roles: Array<string | null | undefined> | undefined): boolean {
  const codes = buildRoleCodeSet(roles);
  return codes.has("SECRETARY");
}

export function hasParentRole(roles: Array<string | null | undefined> | undefined): boolean {
  const codes = buildRoleCodeSet(roles);
  return codes.has("PARENT");
}

export function hasPrincipalRole(roles: Array<string | null | undefined> | undefined): boolean {
  const codes = buildRoleCodeSet(roles);
  return codes.has("PRINCIPAL") || codes.has("HEAD_TEACHER") || codes.has("HEADTEACHER");
}

export function resolveTenantDashboard(
  roles: Array<string | null | undefined> | undefined
): string {
  if (hasDirectorRole(roles)) return "/tenant/director/dashboard";
  if (hasPrincipalRole(roles)) return "/tenant/principal/dashboard";
  if (hasSecretaryRole(roles)) return "/tenant/secretary/dashboard";
  if (hasParentRole(roles)) return "/tenant/parent/dashboard";
  return "/tenant/dashboard";
}
