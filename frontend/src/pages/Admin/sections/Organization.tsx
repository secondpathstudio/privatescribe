import { API_BASE } from "@/lib/api";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/context/auth-context";
import NeoButton from "@/components/neo/neo-button";
import SectionHeader from "./SectionHeader";

export default function OrganizationSection() {
  const auth = useAuth();
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
          headers: { Authorization: `Bearer ${auth.token}` },
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
  }, [auth.token]);

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/organization`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.token}`,
        },
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

  return (
    <>
      <SectionHeader
        title="Organization"
        description="The practice or clinic this installation belongs to. Every user belongs to it; new users inherit it automatically."
      />
      {loading && <p>Loading organization…</p>}
      {error && <p className="text-red-600">Error: {error}</p>}
      {!loading && !error && (
        <div className="flex flex-col gap-6">
          {savedName === null && (
            <p className="border-4 border-black bg-yellow-100 p-3 text-sm">
              This installation has no organization yet. Set one below — every
              existing user will be adopted into it.
            </p>
          )}
          <div className="flex items-end gap-3">
            <div className="flex flex-col gap-1">
              <label
                htmlFor="org-name"
                className="text-xs font-black uppercase tracking-wider"
              >
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
            <NeoButton
              onClick={save}
              disabled={!dirty || saving}
              backgroundColor="#fd3777"
              textColor="#ffffff"
            >
              {saving ? "Saving…" : "Save"}
            </NeoButton>
          </div>
        </div>
      )}
    </>
  );
}
