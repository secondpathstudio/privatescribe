import { useEffect, useMemo, useState } from "react";
import { API_BASE } from "@/lib/api";
import { useAuth } from "@/context/auth-context";
import { isSuperAdmin } from "@/lib/roles";
import SectionHeader from "./SectionHeader";

type Tpl = {
  id: string;
  name: string;
  templateType: string;
  version: number;
  isDeleted: boolean;
  updatedAt: string | null;
  author: { id: string; name: string; email: string } | null;
  organization: { id: string; name: string } | null;
  sharedRoles: { id: string; name: string }[];
};

const NO_ORG = "— No organization (central) —";

export default function TemplatesSection() {
  const auth = useAuth();
  const superAdmin = isSuperAdmin(auth.user?.role);
  const [templates, setTemplates] = useState<Tpl[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!superAdmin) return;
    let cancelled = false;
    fetch(`${API_BASE}/api/templates/all`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 403 ? "Super-admin access required." : `Status ${r.status}`);
        return r.json();
      })
      .then((d) => { if (!cancelled) setTemplates(Array.isArray(d) ? d : []); })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [auth.token, superAdmin]);

  // Group by organization name so it's obvious which department owns what.
  const groups = useMemo(() => {
    const m = new Map<string, Tpl[]>();
    for (const t of templates ?? []) {
      const key = t.organization?.name ?? NO_ORG;
      const list = m.get(key) ?? [];
      list.push(t);
      m.set(key, list);
    }
    // Org-less group sorts last; the rest alphabetical.
    return [...m.entries()].sort(([a], [b]) =>
      a === NO_ORG ? 1 : b === NO_ORG ? -1 : a.localeCompare(b),
    );
  }, [templates]);

  if (!superAdmin) {
    return (
      <>
        <SectionHeader title="Templates" description="All templates across the server." />
        <p className="text-sm text-muted-foreground">
          The cross-organization template list is available to the super-admin (central IT) account.
        </p>
      </>
    );
  }

  return (
    <>
      <SectionHeader
        title="Templates"
        description="Every template on this server and the organization it belongs to."
      />
      {error && <p className="text-red-600 text-sm mb-4">Error: {error}</p>}
      {templates === null && !error && <p>Loading templates…</p>}
      {templates !== null && templates.length === 0 && (
        <p className="text-sm text-muted-foreground">No templates exist yet.</p>
      )}

      <div className="space-y-6">
        {groups.map(([orgName, tpls]) => (
          <div key={orgName} className="border-4 border-black">
            <div className="flex items-center justify-between border-b-4 border-black bg-black px-3 py-2 text-white">
              <span className="font-black uppercase tracking-wider">{orgName}</span>
              <span className="text-xs tabular-nums">{tpls.length} template{tpls.length === 1 ? "" : "s"}</span>
            </div>
            <div className="grid grid-cols-[1fr_auto] gap-2 border-b-2 border-black px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              <span>Name / Owner</span>
              <span>Type · Shared with</span>
            </div>
            {tpls.map((t) => (
              <div key={t.id} className="grid grid-cols-[1fr_auto] items-start gap-2 border-b-2 border-black px-3 py-2 last:border-b-0">
                <div className="min-w-0">
                  <div className="font-bold">
                    {t.name}
                    {t.isDeleted && (
                      <span className="ml-2 border border-red-600 px-1 text-[10px] font-black uppercase text-red-600">Trashed</span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground break-all">
                    {t.author ? `${t.author.name} · ${t.author.email}` : "Unknown owner"}
                  </div>
                </div>
                <div className="text-right">
                  <span className="inline-block border-2 border-black bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
                    {t.templateType}
                  </span>
                  <div className="mt-1 flex flex-wrap justify-end gap-1">
                    {t.sharedRoles.length > 0 ? (
                      t.sharedRoles.map((r) => (
                        <span key={r.id} className="inline-block border-2 border-black bg-[#fd3777] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                          {r.name}
                        </span>
                      ))
                    ) : (
                      <span className="text-[10px] text-muted-foreground">not shared</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
