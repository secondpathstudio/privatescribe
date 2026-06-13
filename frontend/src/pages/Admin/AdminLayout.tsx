import { Link, NavLink, Outlet } from "react-router";
import { useAuth } from "@/context/auth-context";
import { isSuperAdmin } from "@/lib/roles";

type NavItem = { to: string; label: string; superAdminOnly?: boolean };
type NavGroup = { heading: string | null; items: NavItem[] };

const NAV: NavGroup[] = [
  {
    heading: null,
    items: [{ to: "/admin/overview", label: "Overview" }],
  },
  {
    heading: "Users & Access",
    items: [
      { to: "/admin/organization", label: "Organization" },
      { to: "/admin/users", label: "Users" },
      { to: "/admin/roles", label: "Roles" },
      { to: "/admin/audit-log", label: "Audit Log" },
      { to: "/admin/session", label: "Session" },
      { to: "/admin/two-factor", label: "Two-Factor Auth" },
      { to: "/admin/password-policy", label: "Password Policy" },
      { to: "/admin/no-login", label: "No-Login Mode" },
    ],
  },
  {
    heading: "Data & Security",
    items: [
      { to: "/admin/encryption", label: "Encryption" },
      // Cross-org template inventory — central IT only.
      { to: "/admin/templates", label: "Templates", superAdminOnly: true },
      { to: "/admin/trash-retention", label: "Trash & Retention" },
      { to: "/admin/audio-storage", label: "Audio Storage" },
      { to: "/admin/exports", label: "Document Exports" },
    ],
  },
  {
    heading: "System",
    items: [
      { to: "/admin/server", label: "Server" },
      { to: "/admin/models", label: "Models" },
      { to: "/admin/upload-limit", label: "Upload Limit" },
      { to: "/admin/diarization", label: "Diarization" },
      { to: "/admin/dictation-markers", label: "Dictation Commands" },
      { to: "/admin/vocabulary", label: "Vocabulary & Abbreviations" },
    ],
  },
];

export default function AdminLayout() {
  const auth = useAuth();
  const superAdmin = isSuperAdmin(auth.user?.role);
  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col md:flex-row">
      <aside className="md:w-60 md:shrink-0 border-b-2 md:border-b-0 md:border-r-2 border-black bg-white">
        <div className="px-4 pt-4 pb-3">
          <Link
            to="/notes"
            className="inline-flex items-center text-xs font-bold uppercase tracking-wider text-muted-foreground hover:text-black"
          >
            ← Workspace
          </Link>
          <h1 className="mt-2 text-2xl font-black">Admin</h1>
        </div>
        <nav className="px-2 pb-6 space-y-5">
          {NAV.map((group) => (
            <div key={group.heading ?? "_top"}>
              {group.heading && (
                <div className="px-2 pb-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  {group.heading}
                </div>
              )}
              <ul className="space-y-0.5">
                {group.items
                  .filter((item) => !item.superAdminOnly || superAdmin)
                  .map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end
                      className={({ isActive }) =>
                        [
                          "block px-3 py-1.5 text-sm font-medium border-2",
                          isActive
                            ? "border-black bg-[#fd3777] text-white"
                            : "border-transparent hover:border-black hover:bg-gray-50",
                        ].join(" ")
                      }
                    >
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
      <main className="flex-1 min-w-0 px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
