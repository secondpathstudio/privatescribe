/**
 * Privilege-role helpers, mirroring the backend's tiers (security/auth.py):
 *   user        — regular user
 *   admin       — org-admin: admin rights within their own organization
 *   super_admin — central IT: spans all organizations
 *
 * A super-admin is a strict superset of admin, so every "is this an admin?"
 * check in the UI must accept both — otherwise central IT is locked out of the
 * admin console. Always gate admin UI on `isAdmin(role)`, never `role === 'admin'`.
 */
export function isAdmin(role?: string | null): boolean {
  return role === "admin" || role === "super_admin";
}

export function isSuperAdmin(role?: string | null): boolean {
  return role === "super_admin";
}
