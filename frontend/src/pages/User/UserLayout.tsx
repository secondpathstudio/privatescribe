import { NavLink, Outlet } from "react-router";

type NavItem = { to: string; label: string };
type NavGroup = { heading: string | null; items: NavItem[] };

const NAV: NavGroup[] = [
  {
    heading: "Workspace",
    items: [
      { to: "/notes", label: "Notes" },
      { to: "/templates", label: "Templates" },
      { to: "/queue", label: "Upload Queue" },
    ],
  },
  {
    heading: "Settings",
    items: [{ to: "/account", label: "Account" }],
  },
];

/**
 * Sidebar layout for signed-in user work areas (notes, templates). Matches
 * AdminLayout's shape so the two surfaces feel like siblings. Outlet area
 * intentionally omits padding so existing pages can keep their own
 * max-w-* / mx-auto wrappers.
 */
export default function UserLayout() {
  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col md:flex-row">
      <aside className="md:w-60 md:shrink-0 border-b-2 md:border-b-0 md:border-r-2 border-black bg-white">
        <nav className="px-2 py-5 space-y-5">
          {NAV.map((group) => (
            <div key={group.heading ?? "_top"}>
              {group.heading && (
                <div className="px-2 pb-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  {group.heading}
                </div>
              )}
              <ul className="space-y-0.5">
                {group.items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
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
      <main className="flex-1 min-w-0">
        <Outlet />
      </main>
    </div>
  );
}
