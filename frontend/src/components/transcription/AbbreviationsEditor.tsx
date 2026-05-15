import { API_BASE } from "@/lib/api";
import { useEffect, useState } from "react";
import { useAuth } from "@/context/auth-context";
import NeoButton from "@/components/neo/neo-button";

type Props = {
  // Backend endpoint that returns and accepts {abbreviations: {short:long}}.
  endpoint: string;
  title: string;
  description: string;
};

// Same separators the backend parser accepts. Keeping them in sync means a
// round-trip through save → reload renders the same canonical form.
const LINE_RE = /^\s*(.+?)\s*(?:=|:|->|→)\s*(.+?)\s*$/;

function parseTextarea(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split("\n")) {
    const m = rawLine.match(LINE_RE);
    if (!m) continue;
    const [, short, long] = m;
    if (short && long) out[short] = long;
  }
  return out;
}

function formatMap(map: Record<string, string>): string {
  return Object.entries(map)
    .map(([k, v]) => `${k} = ${v}`)
    .join("\n");
}

export default function AbbreviationsEditor({ endpoint, title, description }: Props) {
  const auth = useAuth();
  const [draft, setDraft] = useState<string>("");
  const [saved, setSaved] = useState<string>("");
  const [inheritedAbbreviations, setInheritedAbbreviations] = useState<
    Record<string, string>
  >({});
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
        const text = formatMap(data.abbreviations ?? {});
        setDraft(text);
        setSaved(text);
        setInheritedAbbreviations(
          data.admin_abbreviations &&
            typeof data.admin_abbreviations === "object"
            ? data.admin_abbreviations
            : {},
        );
        setError(null);
      } catch (e: any) {
        if (!cancelled) setError(e.message ?? "Could not load abbreviations");
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
      const abbreviations = parseTextarea(draft);
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify({ abbreviations }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Server error: ${res.status}`);
      const text = formatMap(data.abbreviations ?? {});
      setDraft(text);
      setSaved(text);
    } catch (e: any) {
      setError(e.message ?? "Could not save");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-sm text-muted-foreground">Loading...</p>;

  const inheritedEntries = Object.entries(inheritedAbbreviations);

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
        placeholder={"HTN = hypertension\nBP = blood pressure\nc/o = complains of"}
        className="w-full border-2 border-black p-3 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-[#fd3777]"
      />

      <p className="text-xs text-muted-foreground">
        One per line as <span className="font-mono">SHORT = LONG</span>. Also
        accepts <span className="font-mono">:</span>,{" "}
        <span className="font-mono">-&gt;</span>, or{" "}
        <span className="font-mono">→</span> as the separator. Matching is
        case-insensitive on whole words; the long form is written exactly
        as typed.
      </p>

      {inheritedEntries.length > 0 && (
        <div className="border-2 border-dashed border-black bg-gray-50 p-3">
          <p className="text-xs font-bold uppercase tracking-wider mb-1">
            Inherited from admin
          </p>
          <p className="text-xs text-muted-foreground font-mono">
            {inheritedEntries.map(([k, v]) => `${k} = ${v}`).join(" • ")}
          </p>
          <p className="text-[11px] text-muted-foreground mt-1">
            Adding the same short form above overrides the inherited value.
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
