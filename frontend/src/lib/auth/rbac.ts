export function hasRole(roles: string[] | undefined, code: string) {
  return (roles || []).includes(code);
}

export function hasPermission(perms: string[] | undefined, code: string) {
  return (perms || []).includes(code);
}
