import { API_BASE } from "@/lib/api";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/context/auth-context";
import NeoButton from "@/components/neo/neo-button";
import SectionHeader from "./SectionHeader";

type Role = { id: string; name: string };

export default function RolesSection() {
  const auth = useAuth();
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const fetchRoles = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/roles`, {
          headers: { Authorization: `Bearer ${auth.token}` },
        });
        if (!res.ok) throw new Error(`Server error: ${res.status}`);
        setRoles(await res.json());
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load roles");
      } finally {
        setLoading(false);
      }
    };
    fetchRoles();
  }, [auth.token]);

  const createRole = async () => {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const res = await fetch(`${API_BASE}/api/roles`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || `Could not create the role (status ${res.status}).`);
        return;
      }
      setRoles((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName("");
    } catch {
      toast.error("Couldn't reach the server. Please try again.");
    } finally {
      setCreating(false);
    }
  };

  const deleteRole = async (role: Role) => {
    if (!confirm(
      `Delete the "${role.name}" role? Users lose it, and any templates shared with it lose that sharing.`,
    )) {
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/roles/${role.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || `Could not delete the role (status ${res.status}).`);
        return;
      }
      setRoles((prev) => prev.filter((r) => r.id !== role.id));
    } catch {
      toast.error("Couldn't reach the server. Please try again.");
    }
  };

  return (
    <>
      <SectionHeader
        title="Roles"
        description="Roles group users for template sharing. Create roles here, then assign them to users and share templates with them."
      />
      {loading && <p>Loading roles…</p>}
      {error && <p className="text-red-600">Error: {error}</p>}
      {!loading && !error && (
        <div className="flex flex-col gap-6">
          <div className="flex items-end gap-3">
            <div className="flex flex-col gap-1">
              <label
                htmlFor="new-role"
                className="text-xs font-black uppercase tracking-wider"
              >
                New role
              </label>
              <input
                id="new-role"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") createRole(); }}
                placeholder="e.g. Physician"
                maxLength={50}
                className="border-4 border-black bg-white p-2 font-bold focus:outline-none"
              />
            </div>
            <NeoButton
              onClick={createRole}
              disabled={!newName.trim() || creating}
              backgroundColor="#fd3777"
              textColor="#ffffff"
            >
              {creating ? "Adding…" : "Add role"}
            </NeoButton>
          </div>

          {roles.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No roles yet. Create one above.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {roles.map((role) => (
                <li
                  key={role.id}
                  className="flex items-center justify-between border-4 border-black bg-white p-3"
                >
                  <span className="font-black uppercase tracking-wide">{role.name}</span>
                  <button
                    type="button"
                    onClick={() => deleteRole(role)}
                    className="text-xs font-bold uppercase tracking-wider text-red-600 underline"
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
