import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { API_BASE } from "@/lib/api";
import { useAuth } from "@/context/auth-context";
import NeoButton from "@/components/neo/neo-button";

type Job = {
  id: string;
  status: string;
  progress: number;
  stage: string | null;
  label: string | null;
  noteIds: string[];
  templateIds: string[];
  error: string | null;
  createdAt: string;
};

type Tpl = { id: string; name: string; templateType: string };

// A file staged for upload — not sent until the user starts the batch. Each
// carries its own set of templates; the transcript is produced once and
// formatted through each (one draft note per template).
type Staged = { uid: string; file: File; templateIds: string[] };

const ACTIVE = new Set(["queued", "running"]);

const STATUS_STYLE: Record<string, string> = {
  queued: "bg-white",
  running: "bg-[#ffff00]",
  done: "bg-[#c6f6d5] text-green-900",
  failed: "bg-red-200 text-red-900",
  canceled: "bg-gray-200 text-gray-700",
};

const AUDIO_RE = /\.(wav|mp3|m4a|webm|ogg|flac|aac)$/i;

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

let _uid = 0;

/** A checkbox dropdown for picking zero or more templates. Empty = raw transcript. */
function TemplatePicker({
  templates, selected, onChange, disabled,
}: {
  templates: Tpl[];
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const summary =
    selected.length === 0 ? "Raw transcript"
    : selected.length === 1 ? (templates.find((t) => t.id === selected[0])?.name ?? "1 template")
    : `${selected.length} templates`;
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 border-2 border-black bg-white px-2 py-1.5 text-xs font-bold disabled:opacity-50"
      >
        <span className="truncate max-w-[11rem]">{summary}</span>
        <span>▾</span>
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 max-h-64 w-60 overflow-auto border-2 border-black bg-white shadow-[4px_4px_0px_0px_#000000]">
          {templates.length === 0 ? (
            <div className="p-2 text-xs text-muted-foreground">No simple templates — raw transcript only.</div>
          ) : (
            templates.map((t) => (
              <label key={t.id} className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-xs hover:bg-yellow-100">
                <input type="checkbox" checked={selected.includes(t.id)} onChange={() => toggle(t.id)} />
                <span className="truncate">{t.name}</span>
              </label>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function UploadQueue() {
  const auth = useAuth();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [templates, setTemplates] = useState<Tpl[]>([]);
  const [defaultTemplateIds, setDefaultTemplateIds] = useState<string[]>([]);
  const [staged, setStaged] = useState<Staged[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const authHeader = { Authorization: `Bearer ${auth.token}` };

  useEffect(() => {
    if (!auth.user?.id) return;
    fetch(`${API_BASE}/api/templates/user/${auth.user.id}`, { headers: authHeader })
      .then((r) => (r.ok ? r.json() : []))
      .then((d: Tpl[]) => setTemplates(Array.isArray(d) ? d.filter((t) => t.templateType === "simple") : []))
      .catch(() => setTemplates([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.user?.id]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const r = await fetch(`${API_BASE}/api/jobs`, { headers: authHeader });
        if (r.ok && !cancelled) {
          const data: Job[] = await r.json();
          setJobs(data);
          timer = setTimeout(tick, data.some((j) => ACTIVE.has(j.status)) ? 2000 : 6000);
        } else if (!cancelled) {
          timer = setTimeout(tick, 6000);
        }
      } catch {
        if (!cancelled) timer = setTimeout(tick, 6000);
      }
    };
    tick();
    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.token]);

  const refresh = async () => {
    try {
      const r = await fetch(`${API_BASE}/api/jobs`, { headers: authHeader });
      if (r.ok) setJobs(await r.json());
    } catch { /* the poll will catch up */ }
  };

  const addFiles = (files: File[]) => {
    const audio = files.filter((f) => f.type.startsWith("audio") || AUDIO_RE.test(f.name));
    if (!audio.length) return;
    setStaged((prev) => [
      ...prev,
      ...audio.map((file) => ({ uid: `s${_uid++}`, file, templateIds: [...defaultTemplateIds] })),
    ]);
    if (inputRef.current) inputRef.current.value = "";
  };

  // Changing the default re-applies it to every staged row (the common batch
  // case is one set of templates for all); per-row tweaks come after.
  const applyDefault = (ids: string[]) => {
    setDefaultTemplateIds(ids);
    setStaged((prev) => prev.map((s) => ({ ...s, templateIds: [...ids] })));
  };

  const setRowTemplates = (uid: string, ids: string[]) =>
    setStaged((prev) => prev.map((s) => (s.uid === uid ? { ...s, templateIds: ids } : s)));

  const removeRow = (uid: string) => setStaged((prev) => prev.filter((s) => s.uid !== uid));

  const start = async () => {
    if (!staged.length) return;
    setUploading(true);
    let ok = 0;
    for (const row of [...staged]) {
      const fd = new FormData();
      fd.append("audio", row.file);
      for (const id of row.templateIds) fd.append("templateIds", id);
      try {
        const r = await fetch(`${API_BASE}/api/jobs/transcribe`, { method: "POST", headers: authHeader, body: fd });
        if (r.ok) {
          ok++;
          setStaged((prev) => prev.filter((s) => s.uid !== row.uid));
        } else {
          const d = await r.json().catch(() => ({}));
          toast.error(`${row.file.name}: ${d.error || `upload failed (${r.status})`}`);
        }
      } catch {
        toast.error(`${row.file.name}: couldn't reach the server.`);
      }
    }
    setUploading(false);
    if (ok) toast.success(`Queued ${ok} recording${ok === 1 ? "" : "s"} for transcription.`);
    refresh();
  };

  const cancel = async (id: string) => {
    const r = await fetch(`${API_BASE}/api/jobs/${id}/cancel`, { method: "POST", headers: authHeader });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      toast.error(d.error || "Couldn't cancel the job.");
    }
    refresh();
  };

  const activeCount = jobs.filter((j) => ACTIVE.has(j.status)).length;

  return (
    <div className="max-w-3xl px-6 py-8">
      <h1 className="text-3xl font-black">Upload Queue</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Add recordings, choose one or more templates per file (the transcript is
        produced once and run through each — e.g. an encounter note plus an
        ICD-10 extract), then start. They transcribe into draft notes in the
        background; you can leave this page.
      </p>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(Array.from(e.dataTransfer.files)); }}
        className={[
          "mt-6 border-4 border-dashed p-6 text-center",
          dragging ? "border-[#fd3777] bg-pink-50" : "border-black bg-white",
        ].join(" ")}
      >
        <p className="font-bold">Drag audio files here</p>
        <p className="mt-1 text-sm text-muted-foreground">or</p>
        <div className="mt-3 flex justify-center">
          <NeoButton onClick={() => inputRef.current?.click()} backgroundColor="#000000" textColor="#ffffff">
            Add files
          </NeoButton>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="audio/*,.wav,.mp3,.m4a,.webm,.ogg,.flac,.aac"
          multiple
          className="hidden"
          onChange={(e) => addFiles(Array.from(e.target.files ?? []))}
        />
      </div>

      {staged.length > 0 && (
        <div className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-black uppercase tracking-wider">Default templates:</span>
              <TemplatePicker
                templates={templates}
                selected={defaultTemplateIds}
                onChange={applyDefault}
                disabled={uploading}
              />
            </div>
            <div className="flex gap-2">
              <NeoButton onClick={() => setStaged([])} disabled={uploading}>Clear</NeoButton>
              <NeoButton onClick={start} disabled={uploading} backgroundColor="#fd3777" textColor="#ffffff">
                {uploading ? "Starting…" : `Start (${staged.length})`}
              </NeoButton>
            </div>
          </div>

          <div className="mt-3 border-4 border-black">
            <div className="grid grid-cols-[1fr_auto] gap-2 border-b-2 border-black bg-black px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-white">
              <span>File</span>
              <span>Templates</span>
            </div>
            {staged.map((s) => (
              <div key={s.uid} className="grid grid-cols-[1fr_auto] items-center gap-2 border-b-2 border-black px-3 py-2 last:border-b-0">
                <div className="min-w-0">
                  <div className="truncate font-bold">{s.file.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {fmtSize(s.file.size)}
                    {s.templateIds.length > 1 && ` · ${s.templateIds.length} notes`}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <TemplatePicker
                    templates={templates}
                    selected={s.templateIds}
                    onChange={(ids) => setRowTemplates(s.uid, ids)}
                    disabled={uploading}
                  />
                  <button
                    onClick={() => removeRow(s.uid)}
                    disabled={uploading}
                    className="text-xs font-bold underline hover:text-red-600 disabled:opacity-50"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-8">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-black uppercase tracking-wider">Queue</h2>
          {activeCount > 0 && <span className="text-xs text-muted-foreground">{activeCount} processing…</span>}
        </div>

        {jobs.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Nothing queued yet.</p>
        ) : (
          <div className="mt-3 border-4 border-black">
            {jobs.map((j) => (
              <div key={j.id} className="border-b-2 border-black px-3 py-2 last:border-b-0">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-bold">{j.label || "Recording"}</div>
                    {j.status === "running" && j.stage && (
                      <div className="text-xs text-muted-foreground">{j.stage}…</div>
                    )}
                    {j.status === "failed" && j.error && (
                      <div className="text-xs text-red-700 break-words">{j.error}</div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className={[
                      "inline-block border-2 border-black px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                      STATUS_STYLE[j.status] || "bg-white",
                    ].join(" ")}>
                      {j.status}
                    </span>
                    {j.status === "done" && j.noteIds.length === 1 && (
                      <Link to={`/notes/${j.noteIds[0]}`} className="text-xs font-bold underline hover:text-[#fd3777]">
                        Open draft
                      </Link>
                    )}
                    {j.status === "done" && j.noteIds.length > 1 && j.noteIds.map((nid, i) => (
                      <Link key={nid} to={`/notes/${nid}`} className="text-xs font-bold underline hover:text-[#fd3777]">
                        Draft {i + 1}
                      </Link>
                    ))}
                    {j.status === "queued" && (
                      <button onClick={() => cancel(j.id)} className="text-xs font-bold underline hover:text-red-600">
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
                {j.status === "running" && (
                  <div className="mt-2 h-2 w-full border-2 border-black bg-white">
                    <div className="h-full bg-[#fd3777]" style={{ width: `${Math.min(100, Math.max(0, j.progress))}%` }} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
