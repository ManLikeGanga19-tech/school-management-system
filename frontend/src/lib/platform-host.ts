export type PortalKind = "public" | "admin" | "tenant";

export type PortalContext = {
  kind: PortalKind;
  hostname: string;
  tenantSlug: string | null;
  publicHost: string | null;
  adminHost: string | null;
  tenantBaseHost: string | null;
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function normalizeHostname(value: string | null | undefined): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .split(",")[0]
    .trim()
    .split(":")[0]
    .trim();
}

function configuredHost(name: "NEXT_PUBLIC_PUBLIC_HOST" | "NEXT_PUBLIC_ADMIN_HOST" | "NEXT_PUBLIC_TENANT_BASE_HOST"): string | null {
  const normalized = normalizeHostname(process.env[name]);
  return normalized || null;
}

export function isLocalHostname(hostname: string | null | undefined): boolean {
  return LOCAL_HOSTS.has(normalizeHostname(hostname));
}

export function resolvePortalContext(hostname: string | null | undefined): PortalContext {
  const normalized = normalizeHostname(hostname);
  const publicHost = configuredHost("NEXT_PUBLIC_PUBLIC_HOST");
  const adminHost = configuredHost("NEXT_PUBLIC_ADMIN_HOST");
  const tenantBaseHost = configuredHost("NEXT_PUBLIC_TENANT_BASE_HOST") || publicHost;

  if (!normalized || isLocalHostname(normalized)) {
    return {
      kind: "public",
      hostname: normalized,
      tenantSlug: null,
      publicHost,
      adminHost,
      tenantBaseHost,
    };
  }

  if ((adminHost && normalized === adminHost) || normalized.startsWith("admin.")) {
    return {
      kind: "admin",
      hostname: normalized,
      tenantSlug: null,
      publicHost,
      adminHost,
      tenantBaseHost,
    };
  }

  if (
    (publicHost && (normalized === publicHost || normalized === `www.${publicHost}`)) ||
    normalized === "shulehq.co.ke" ||
    normalized === "staging.shulehq.co.ke"
  ) {
    return {
      kind: "public",
      hostname: normalized,
      tenantSlug: null,
      publicHost,
      adminHost,
      tenantBaseHost,
    };
  }

  if (tenantBaseHost) {
    const suffix = `.${tenantBaseHost}`;
    if (normalized.endsWith(suffix) && normalized !== tenantBaseHost) {
      const prefix = normalized.slice(0, -suffix.length);
      if (prefix && !prefix.includes(".")) {
        if (prefix === "admin") {
          return {
            kind: "admin",
            hostname: normalized,
            tenantSlug: null,
            publicHost,
            adminHost,
            tenantBaseHost,
          };
        }
        return {
          kind: "tenant",
          hostname: normalized,
          tenantSlug: prefix,
          publicHost,
          adminHost,
          tenantBaseHost,
        };
      }
    }
  }

  return {
    kind: "public",
    hostname: normalized,
    tenantSlug: null,
    publicHost,
    adminHost,
    tenantBaseHost,
  };
}

function buildAbsoluteUrl(hostname: string, path = "/"): string {
  const protocol = isLocalHostname(hostname) ? "http" : "https";
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${protocol}://${hostname}${normalizedPath}`;
}

export function resolveAdminPortalUrl(path = "/"): string | null {
  const adminHost = configuredHost("NEXT_PUBLIC_ADMIN_HOST");
  if (!adminHost) return null;
  return buildAbsoluteUrl(adminHost, path);
}

export function resolvePublicPortalUrl(path = "/"): string | null {
  const publicHost = configuredHost("NEXT_PUBLIC_PUBLIC_HOST");
  if (!publicHost) return null;
  return buildAbsoluteUrl(publicHost, path);
}
