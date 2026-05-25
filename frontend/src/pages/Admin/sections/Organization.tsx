import { API_BASE } from "@/lib/api";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/context/auth-context";
import { isSuperAdmin } from "@/lib/roles";
import NeoButton from "@/components/neo/neo-button";
import SectionHeader from "./SectionHeader";

type Org = { id: string; name: string; userCount: number };

/**
 * Super-admin (central IT) view: every organization/department on this server,
 * with a create form. Org assignment of users happens in the Users section.
 */
function SuperAdminOrgs({ token }: { token: string | null }) {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const load = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/organization/list`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data = await res.json();
      setOrgs(data.organizations ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load organizations");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const create = async () => {
    const trimmed = newName.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/organization/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || `Could not create the organization (status ${res.status}).`);
        return;
      }
      toast.success(`Created "${trimmed}".`);
      setNewName("");
      load();
    } catch {
      toast.error("Couldn't reach the server. Please try again.");
    } finally {
      setCreating(false);
    }
  };

  if (loading) return <p>Loading organizations…</p>;
  if (error) return <p className="text-red-600">Error: {error}</p>;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="new-org" className="text-xs font-black uppercase tracking-wider">
            New organization
          </label>
          <input
            id="new-org"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") create(); }}
            placeholder="e.g. Cardiology"
            maxLength={255}
            className="w-80 border-4 border-black bg-white p-2 font-bold focus:outline-none"
          />
        </div>
        <NeoButton onClick={create} disabled={!newName.trim() || creating}
          backgroundColor="#fd3777" textColor="#ffffff">
          {creating ? "Creating…" : "Create"}
        </NeoButton>
      </div>

      <div className="border-4 border-black">
        <div className="grid grid-cols-[1fr_auto] gap-2 border-b-4 border-black bg-black px-3 py-2 text-xs font-black uppercase tracking-wider text-white">
          <span>Organization</span>
          <span>Users</span>
        </div>
        {orgs.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">No organizations yet.</p>
        ) : (
          orgs.map((o) => (
            <div key={o.id} className="grid grid-cols-[1fr_auto] gap-2 border-b-2 border-black px-3 py-2 last:border-b-0">
              <span className="font-bold">{o.name}</span>
              <span className="tabular-nums">{o.userCount}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/** Org-admin view: rename their own single organization (legacy single-install
 *  path included — adopts org-less users when no org exists yet). */
function OwnOrg({ token }: { token: string | null }) {
  const [name, setName] = useState("");
  // null = this install has no organization row yet (predates the feature).
  const [savedName, setSavedName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const fetchOrg = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/admin/organization`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`Server error: ${res.status}`);
        const data = await res.json();
        setName(data.organization?.name ?? "");
        setSavedName(data.organization?.name ?? null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load organization");
      } finally {
        setLoading(false);
      }
    };
    fetchOrg();
  }, [token]);

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/organization`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || `Could not save the organization (status ${res.status}).`);
        return;
      }
      const newName = data.organization?.name ?? trimmed;
      setName(newName);
      setSavedName(newName);
      toast.success("Organization saved.");
    } catch {
      toast.error("Couldn't reach the server. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const dirty = name.trim().length > 0 && name.trim() !== (savedName ?? "");

  if (loading) return <p>Loading organization…</p>;
  if (error) return <p className="text-red-600">Error: {error}</p>;

  return (
    <div className="flex flex-col gap-6">
      {savedName === null && (
        <p className="border-4 border-black bg-yellow-100 p-3 text-sm">
          This installation has no organization yet. Set one below — every
          existing user will be adopted into it.
        </p>
      )}
      <div className="flex items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="org-name" className="text-xs font-black uppercase tracking-wider">
            Organization name
          </label>
          <input
            id="org-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") save(); }}
            placeholder="e.g. Riverside Family Medicine"
            maxLength={255}
            className="w-80 border-4 border-black bg-white p-2 font-bold focus:outline-none"
          />
        </div>
        <NeoButton onClick={save} disabled={!dirty || saving}
          backgroundColor="#fd3777" textColor="#ffffff">
          {saving ? "Saving…" : "Save"}
        </NeoButton>
      </div>
    </div>
  );
}

export default function OrganizationSection() {
  const auth = useAuth();
  const superAdmin = isSuperAdmin(auth.user?.role);
  return (
    <>
      <SectionHeader
        title={superAdmin ? "Organizations" : "Organization"}
        description={
          superAdmin
            ? "The departments/practices on this server. Create one per department; assign each user to theirs in the Users section."
            : "The practice or clinic this installation belongs to. Every user belongs to it; new users inherit it automatically."
        }
      />
      {superAdmin ? <SuperAdminOrgs token={auth.token} /> : <OwnOrg token={auth.token} />}
    </>
  );
}
