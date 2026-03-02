export const TENANT_BRANDING_UPDATED_EVENT = "sms:tenant-branding-updated";

export function notifyTenantBrandingUpdated(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(TENANT_BRANDING_UPDATED_EVENT));
}
