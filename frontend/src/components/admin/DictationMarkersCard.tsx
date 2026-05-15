import { API_BASE } from "@/lib/api";
import { useEffect, useState } from "react";
import { useAuth } from "@/context/auth-context";
import NeoButton from "@/components/neo/neo-button";

type Settings = { dictation_markers_enabled: boolean };

export default function DictationMarkersCard() {
  const auth = useAuth();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<boolean>(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/admin/settings`, {
          headers: { Authorization: `Bearer ${auth.token}` },
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Server error: ${res.status}`);
        if (cancelled) return;
        setSettings({ dictation_markers_enabled: !!data.dictation_markers_enabled });
        setDraft(!!data.dictation_markers_enabled);
        setError(null);
      } catch (e: any) {
        if (!cancelled) setError(e.message ?? "Could not load settings");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auth.token]);

  const dirty = settings !== null && draft !== settings.dictation_markers_enabled;

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/admin/settings/dictation-markers-enabled`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${auth.token}`,
          },
          body: JSON.stringify({ value: draft }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Server error: ${res.status}`);
      setSettings({ dictation_markers_enabled: !!data.dictation_markers_enabled });
      setDraft(!!data.dictation_markers_enabled);
      // Mirror onto the cached user so the NewNote per-note toggle hides
      // immediately when an admin disables the feature.
      auth.updateUser({ dictationMarkersEnabled: !!data.dictation_markers_enabled });
    } catch (e: any) {
      setError(e.message ?? "Could not save");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-sm text-muted-foreground">Loading...</p>;
  if (!settings) {
    return <p className="text-red-600 text-sm">{error ?? "Could not load settings"}</p>;
  }

  return (
    <div className="border-2 border-black bg-white p-5 space-y-4">
      <div>
        <h3 className="font-black text-lg">Honor spoken dictation commands</h3>
        <p className="text-sm text-muted-foreground">
          When enabled, the transcription pipeline rewrites spoken commands
          into formatting before storing the note and before the AI pass:
        </p>
        <ul className="mt-2 text-sm text-muted-foreground list-disc pl-5 space-y-0.5">
          <li>
            <span className="font-mono">"new paragraph"</span> → blank line
          </li>
          <li>
            <span className="font-mono">"new line"</span> → single line break
          </li>
          <li>
            <span className="font-mono">"period"</span> → <span className="font-mono">.</span>
          </li>
          <li>
            <span className="font-mono">"comma"</span> → <span className="font-mono">,</span>
          </li>
        </ul>
        <p className="mt-2 text-sm text-muted-foreground">
          Paragraph and line breaks only trigger when the phrase is spoken
          as its own sentence — "I'd like to start a new paragraph" mid-flow
          stays as literal text. Punctuation markers fire on any standalone
          occurrence, which means content like "the recovery period" or
          "place a comma after John" will be rewritten — turn this off if
          your recordings often contain those words as content. Diarized
          (multi-speaker) recordings are never rewritten.
        </p>
      </div>
      <label className="flex items-start gap-3 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={draft}
          onChange={(e) => setDraft(e.target.checked)}
          className="mt-1 size-4 border-2 border-black accent-[#fd3777]"
        />
        <span className="text-sm">
          <strong>Enabled.</strong> Rewrite dictation commands into formatting.
        </span>
      </label>

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
            onClick={() => setDraft(settings.dictation_markers_enabled)}
            className="text-xs underline text-muted-foreground"
          >
            Revert
          </button>
        )}
      </div>
    </div>
  );
}
