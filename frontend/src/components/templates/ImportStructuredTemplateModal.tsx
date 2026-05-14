import { API_BASE } from "@/lib/api";
import { DragEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/context/auth-context";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import NeoButton from "@/components/neo/neo-button";

type OllamaModel = { name: string; parameter_size?: string | null };

type Props = {
  onClose: () => void;
  onImported?: (template: any) => void;
  // Pre-fills the JSON textarea when the modal is opened by a page-level
  // file drop. Read once on mount; subsequent changes don't clobber edits.
  initialJson?: string;
};

/**
 * Paste-JSON import for templates built in PrivateScribe Studio. Auto-fills
 * the name from the pasted JSON when present; user picks the local Ollama
 * model to run it against. Backend validates the structured shape; this
 * modal handles parse errors locally and surfaces server errors inline.
 */
export default function ImportStructuredTemplateModal({ onClose, onImported, initialJson }: Props) {
  const auth = useAuth();
  const [json, setJson] = useState(initialJson ?? "");
  const [name, setName] = useState("");
  const [llmModel, setLlmModel] = useState("");
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Pull installed models so the user picks something that's actually loaded.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/ollama/models`, {
          headers: { Authorization: `Bearer ${auth.token}` },
        });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setModelsError(data.error || "Could not load models");
          setModels([]);
          return;
        }
        setModels(data.models || []);
        if (data.default && (data.models || []).some((m: OllamaModel) => m.name === data.default)) {
          setLlmModel(data.default);
        } else if (data.models && data.models.length) {
          setLlmModel(data.models[0].name);
        }
        setModelsError(null);
      } catch {
        if (!cancelled) setModelsError("Could not reach the server");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auth.token]);

  // Live-parse the pasted JSON so we can pre-fill the name field as soon as
  // the user has a valid object. Parse errors render below the textarea.
  const parsed = useMemo(() => {
    if (!json.trim()) {
      setParseError(null);
      return null;
    }
    try {
      const value = JSON.parse(json);
      setParseError(null);
      return value;
    } catch (e: any) {
      setParseError(e.message || "Invalid JSON");
      return null;
    }
  }, [json]);

  // Pre-fill name from the parsed JSON's `name` field — but only while the
  // name input is still empty so we don't clobber the user's edits.
  useEffect(() => {
    if (parsed && typeof parsed.name === "string" && !name) {
      setName(parsed.name);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed]);

  const ingestFile = async (file: File) => {
    setFileError(null);
    if (file.size > 1024 * 1024) {
      setFileError("File is larger than 1MB — that's almost certainly not a template.");
      return;
    }
    const looksJson = file.name.toLowerCase().endsWith(".json") || file.type === "application/json";
    try {
      const text = await file.text();
      setJson(text);
      if (!looksJson) {
        setFileError(`"${file.name}" isn't a .json file — pasted as-is; check it parses.`);
      }
    } catch (e: any) {
      setFileError(e?.message || "Could not read file");
    }
  };

  const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    await ingestFile(file);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!dragOver) setDragOver(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  };

  const canSubmit = !!parsed && !!name.trim() && !!llmModel && !submitting;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setServerError(null);
    if (!parsed) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/templates`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify({
          name: name.trim(),
          templateType: "structured",
          structured: parsed,
          llmModel,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setServerError(data.error || `Server error ${res.status}`);
        return;
      }
      onImported?.(data);
      onClose();
    } catch (e: any) {
      setServerError(e.message ?? "Network error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl border-[3px] border-black bg-white shadow-[6px_6px_0_0_#000]">
        <div className="border-b-2 border-black bg-[#5d1d91] px-5 py-3">
          <h3 className="font-black uppercase tracking-wide text-white">
            Import structured template
          </h3>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <p className="text-sm text-muted-foreground">
            Paste a JSON template exported from <strong>PrivateScribe Studio</strong>.
            We'll validate the shape and store it; you can use it from the
            new-note picker once imported.
          </p>

          <div>
            <div className="flex items-center justify-between">
              <Label htmlFor="import-json" className="font-black">
                Template JSON
              </Label>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="text-xs font-bold uppercase tracking-wide underline"
              >
                Browse file…
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) ingestFile(f);
                  e.target.value = "";
                }}
              />
            </div>
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragEnter={handleDragOver}
              onDragLeave={handleDragLeave}
              className={
                "relative border-[2px] border-black " +
                (dragOver ? "ring-4 ring-[#fd3777]" : "")
              }
            >
              <textarea
                id="import-json"
                value={json}
                onChange={(e) => setJson(e.target.value)}
                placeholder='Drop a .json file here, paste JSON, or click "Browse file…"'
                className="w-full min-h-[180px] bg-white p-2 font-mono text-xs outline-none"
                autoFocus
                required
              />
              {dragOver && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[#fd3777]/10">
                  <span className="font-black uppercase tracking-wider text-[#5d1d91]">
                    Drop to import
                  </span>
                </div>
              )}
            </div>
            {fileError && (
              <p className="text-amber-700 text-xs mt-1">{fileError}</p>
            )}
            {parseError && (
              <p className="text-red-600 text-xs mt-1">
                JSON parse error: {parseError}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="import-name" className="font-black">
                Name
              </Label>
              <Input
                id="import-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Cardiology visit note"
                required
              />
              <p className="text-xs text-muted-foreground mt-1">
                Auto-filled from the JSON; edit if you want something different.
              </p>
            </div>
            <div>
              <Label htmlFor="import-model" className="font-black">
                LLM model
              </Label>
              <select
                id="import-model"
                value={llmModel}
                onChange={(e) => setLlmModel(e.target.value)}
                disabled={models.length === 0}
                className="w-full border-[2px] border-black bg-white px-2 py-1.5 text-sm"
                required
              >
                {models.length === 0 && (
                  <option value="">
                    {modelsError ? "Models unavailable" : "Loading models..."}
                  </option>
                )}
                {models.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name}
                    {m.parameter_size ? ` (${m.parameter_size})` : ""}
                  </option>
                ))}
              </select>
              {modelsError && (
                <p className="text-xs text-red-600 mt-1">{modelsError}</p>
              )}
            </div>
          </div>

          {serverError && (
            <div className="border-[2px] border-black bg-red-50 p-3 text-sm text-red-700">
              {serverError}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <NeoButton
              type="button"
              onClick={onClose}
              backgroundColor="#ffffff"
              textColor="#000000"
              disabled={submitting}
            >
              Cancel
            </NeoButton>
            <NeoButton
              type="submit"
              backgroundColor="#fd3777"
              textColor="#ffffff"
              disabled={!canSubmit}
            >
              {submitting ? "Importing..." : "Import"}
            </NeoButton>
          </div>
        </form>
      </div>
    </div>
  );
}
