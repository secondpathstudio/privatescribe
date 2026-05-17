import { API_BASE } from "@/lib/api";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/context/auth-context";
import NeoButton from "@/components/neo/neo-button";

type Role = { id: string; name: string };

type Props = {
  templateId: string;
  templateName: string;
  currentRoles: Role[];
  onClose: () => void;
  onSaved: (roles: Role[]) => void;
};

export default function ShareTemplateModal({
  templateId,
  templateName,
  currentRoles,
  onClose,
  onSaved,
}: Props) {
  const auth = useAuth();
  // null = the full role list hasn't loaded yet.
  const [allRoles, setAllRoles] = useState<Role[] | null>(null);
  const [selected, setSelected] = useState<string[]>(currentRoles.map((r) => r.id));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/roles`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    })
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setAllRoles(Array.isArray(d) ? d : []); })
      .catch(() => { if (!cancelled) setAllRoles([]); });
    return () => { cancelled = true; };
  }, [auth.token]);

  const toggle = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/templates/${templateId}/roles`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify({ roleIds: selected }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || `Could not save sharing (status ${res.status}).`);
        return;
      }
      onSaved(data.sharedRoles ?? []);
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
        <h2 className="text-2xl font-black uppercase">Share with roles</h2>
        <p className="mt-1 break-all text-sm text-muted-foreground">{templateName}</p>
        <p className="mt-2 text-sm">
          Anyone who holds a selected role can use this template — read-only.
        </p>

        <div className="mt-4">
          {allRoles === null ? (
            <p className="text-sm text-muted-foreground">Loading roles…</p>
          ) : allRoles.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No roles exist yet. Create roles on the Admin → Roles page first.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {allRoles.map((role) => {
                const on = selected.includes(role.id);
                return (
                  <button
                    key={role.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(role.id)}
                    className={
                      "border-2 border-black px-3 py-1 text-sm font-bold uppercase tracking-wide " +
                      (on ? "bg-[#fd3777] text-white" : "bg-white text-black")
                    }
                  >
                    {role.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-6 flex items-center justify-end gap-3">
          <NeoButton onClick={onClose} disabled={saving}>
            Cancel
          </NeoButton>
          <NeoButton
            onClick={save}
            disabled={saving || allRoles === null}
            backgroundColor="#fd3777"
            textColor="#ffffff"
          >
            {saving ? "Saving…" : "Save"}
          </NeoButton>
        </div>
      </div>
    </div>
  );
}
