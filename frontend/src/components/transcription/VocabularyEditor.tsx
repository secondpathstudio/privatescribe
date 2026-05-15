import { API_BASE } from "@/lib/api";
import { useEffect, useState } from "react";
import { useAuth } from "@/context/auth-context";
import NeoButton from "@/components/neo/neo-button";

type Props = {
  // Backend endpoint that returns and accepts {terms: string[]}. Use the
  // admin route for admin scope, the /api/user route for the per-user
  // overlay. Same shape on both.
  endpoint: string;
  title: string;
  description: string;
};

export default function VocabularyEditor({ endpoint, title, description }: Props) {
  const auth = useAuth();
  const [draft, setDraft] = useState<string>("");
  const [saved, setSaved] = useState<string>("");
  const [inheritedTerms, setInheritedTerms] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}${endpoint}`, {
          headers: { Authorization: `Bearer ${auth.token}` },
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Server error: ${res.status}`);
        if (cancelled) return;
        const text = ((data.terms ?? []) as string[]).join("\n");
        setDraft(text);
        setSaved(text);
        // admin_terms is only present on the user-scoped GET; admin GET
        // returns the same terms field but no admin_terms key.
        setInheritedTerms(Array.isArray(data.admin_terms) ? data.admin_terms : []);
        setError(null);
      } catch (e: any) {
        if (!cancelled) setError(e.message ?? "Could not load vocabulary");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auth.token, endpoint]);

  const dirty = draft !== saved;

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const terms = draft.split("\n").map((t) => t.trim()).filter(Boolean);
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify({ terms }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Server error: ${res.status}`);
      const text = ((data.terms ?? []) as string[]).join("\n");
      setDraft(text);
      setSaved(text);
    } catch (e: any) {
      setError(e.message ?? "Could not save");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-sm text-muted-foreground">Loading...</p>;

  return (
    <div className="border-2 border-black bg-white p-5 space-y-4">
      <div>
        <h3 className="font-black text-lg">{title}</h3>
        <p className="text-sm text-muted-foreground mt-1">{description}</p>
      </div>

      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={8}
        spellCheck={false}
        placeholder={"lisinopril\nmetoprolol\nDr. Patel"}
        className="w-full border-2 border-black p-3 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-[#fd3777]"
      />

      <p className="text-xs text-muted-foreground">
        One term per line. Case-insensitive duplicates are removed on save.
      </p>

      {inheritedTerms.length > 0 && (
        <div className="border-2 border-dashed border-black bg-gray-50 p-3">
          <p className="text-xs font-bold uppercase tracking-wider mb-1">
            Inherited from admin
          </p>
          <p className="text-xs text-muted-foreground font-mono break-words">
            {inheritedTerms.join(", ")}
          </p>
        </div>
      )}

      {error && <p className="text-red-600 text-sm">{error}</p>}

      <div className="flex items-center gap-3">
        <NeoButton
          onClick={handleSave}
          backgroundColor="#fd3777"
          textColor="#ffffff"
          disabled={!dirty || saving}
        >
          {saving ? "Saving..." : "Save"}
        </NeoButton>
        {dirty && !saving && (
          <button
            type="button"
            onClick={() => setDraft(saved)}
            className="text-xs underline text-muted-foreground"
          >
            Revert
          </button>
        )}
      </div>
    </div>
  );
}
