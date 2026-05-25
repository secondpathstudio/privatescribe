import { API_BASE } from "@/lib/api";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/context/auth-context";
import NeoButton from "@/components/neo/neo-button";

type Org = { id: string; name: string; userCount?: number };

type Props = {
  userId: string;
  userEmail: string;
  currentOrgId: string | null;
  onClose: () => void;
  onSaved: (org: { id: string; name: string }) => void;
};

/**
 * Super-admin: move a user to a different organization/department. The backend
 * re-stamps the user's owned PHI to the new org so their history follows them.
 */
export default function ChangeOrgModal({
  userId,
  userEmail,
  currentOrgId,
  onClose,
  onSaved,
}: Props) {
  const auth = useAuth();
  const [orgs, setOrgs] = useState<Org[] | null>(null);
  const [selected, setSelected] = useState<string>(currentOrgId ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/admin/organization/list`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    })
      .then((r) => (r.ok ? r.json() : { organizations: [] }))
      .then((d) => { if (!cancelled) setOrgs(d.organizations ?? []); })
      .catch(() => { if (!cancelled) setOrgs([]); });
    return () => { cancelled = true; };
  }, [auth.token]);

  const save = async () => {
    if (!selected || selected === currentOrgId) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/users/${userId}/organization`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify({ organizationId: selected }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || `Could not move the user (status ${res.status}).`);
        return;
      }
      onSaved(data.organization);
      const moved = data.phiRowsRestamped
        ? ` (${data.phiRowsRestamped} record${data.phiRowsRestamped === 1 ? "" : "s"} moved)`
        : "";
      toast.success(`Moved to ${data.organization?.name}${moved}.`);
      onClose();
    } catch {
      toast.error("Couldn't reach the server. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md border-4 border-black bg-white p-6 shadow-[8px_8px_0px_0px_#000000]">
        <h2 className="text-2xl font-black uppercase">Organization</h2>
        <p className="mt-1 break-all text-sm text-muted-foreground">{userEmail}</p>

        <div className="mt-4">
          {orgs === null ? (
            <p className="text-sm text-muted-foreground">Loading organizations…</p>
          ) : orgs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No organizations exist yet. Create one on the Organizations page first.
            </p>
          ) : (
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="block w-full border-2 border-black bg-white p-2 text-sm font-bold focus:outline-none"
            >
              <option value="" disabled>Select a department…</option>
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            The user's notes, templates, participants, and audio move to the new
            department with them.
          </p>
        </div>

        <div className="mt-6 flex items-center justify-end gap-3">
          <NeoButton onClick={onClose} disabled={saving}>Cancel</NeoButton>
          <NeoButton
            onClick={save}
            disabled={saving || orgs === null || !selected || selected === currentOrgId}
            backgroundColor="#fd3777"
            textColor="#ffffff"
          >
            {saving ? "Moving…" : "Move"}
          </NeoButton>
        </div>
      </div>
    </div>
  );
}
