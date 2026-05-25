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
  noteId: string | null;
  error: string | null;
  createdAt: string;
};

type Tpl = { id: string; name: string; templateType: string };

const ACTIVE = new Set(["queued", "running"]);

const STATUS_STYLE: Record<string, string> = {
  queued: "bg-white",
  running: "bg-[#ffff00]",
  done: "bg-[#c6f6d5] text-green-900",
  failed: "bg-red-200 text-red-900",
  canceled: "bg-gray-200 text-gray-700",
};

export default function UploadQueue() {
  const auth = useAuth();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [templates, setTemplates] = useState<Tpl[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const authHeader = { Authorization: `Bearer ${auth.token}` };

  // Simple templates the user owns, to optionally format each draft.
  useEffect(() => {
    if (!auth.user?.id) return;
    fetch(`${API_BASE}/api/templates/user/${auth.user.id}`, { headers: authHeader })
      .then((r) => (r.ok ? r.json() : []))
      .then((d: Tpl[]) => setTemplates(Array.isArray(d) ? d.filter((t) => t.templateType === "simple") : []))
      .catch(() => setTemplates([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.user?.id]);

  // Poll the queue. Faster while anything is active, slower when idle.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const r = await fetch(`${API_BASE}/api/jobs`, { headers: authHeader });
        if (r.ok && !cancelled) {
          const data: Job[] = await r.json();
          setJobs(data);
          const active = data.some((j) => ACTIVE.has(j.status));
          timer = setTimeout(tick, active ? 2000 : 6000);
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

  const uploadFiles = async (files: File[]) => {
    if (!files.length) return;
    setUploading(true);
    let ok = 0;
    let failed = 0;
    for (const file of files) {
      const fd = new FormData();
      fd.append("audio", file);
      if (templateId) fd.append("templateId", templateId);
      try {
        const r = await fetch(`${API_BASE}/api/jobs/transcribe`, {
          method: "POST",
          headers: authHeader,
          body: fd,
        });
        if (r.ok) {
          ok++;
        } else {
          failed++;
          const d = await r.json().catch(() => ({}));
          toast.error(`${file.name}: ${d.error || `upload failed (${r.status})`}`);
        }
      } catch {
        failed++;
        toast.error(`${file.name}: couldn't reach the server.`);
      }
    }
    setUploading(false);
    if (ok) toast.success(`Queued ${ok} recording${ok === 1 ? "" : "s"} for transcription.`);
    if (inputRef.current) inputRef.current.value = "";
    refresh();
    void failed;
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
        Upload recordings (e.g. off a portable recorder) and PrivateScribe
        transcribes them into draft notes in the background. You can leave this
        page — they keep processing on the server.
      </p>

      {/* Upload controls */}
      <div className="mt-6 space-y-3">
        {templates.length > 0 && (
          <div>
            <label htmlFor="tpl" className="text-xs font-black uppercase tracking-wider">
              Format each draft with (optional)
            </label>
            <select
              id="tpl"
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="mt-1 block w-full border-2 border-black bg-white p-2 text-sm font-bold focus:outline-none"
            >
              <option value="">No formatting — raw transcript</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
        )}

        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            uploadFiles(Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("audio") || /\.(wav|mp3|m4a|webm|ogg|flac|aac)$/i.test(f.name)));
          }}
          className={[
            "border-4 border-dashed p-8 text-center",
            dragging ? "border-[#fd3777] bg-pink-50" : "border-black bg-white",
          ].join(" ")}
        >
          <p className="font-bold">Drag audio files here</p>
          <p className="mt-1 text-sm text-muted-foreground">or</p>
          <div className="mt-3 flex justify-center">
            <NeoButton
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              backgroundColor="#fd3777"
              textColor="#ffffff"
            >
              {uploading ? "Uploading…" : "Choose files"}
            </NeoButton>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="audio/*,.wav,.mp3,.m4a,.webm,.ogg,.flac,.aac"
            multiple
            className="hidden"
            onChange={(e) => uploadFiles(Array.from(e.target.files ?? []))}
          />
        </div>
      </div>

      {/* Queue */}
      <div className="mt-8">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-black uppercase tracking-wider">Queue</h2>
          {activeCount > 0 && (
            <span className="text-xs text-muted-foreground">{activeCount} processing…</span>
          )}
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
                    {j.status === "done" && j.noteId && (
                      <Link to={`/notes/${j.noteId}`} className="text-xs font-bold underline hover:text-[#fd3777]">
                        Open draft
                      </Link>
                    )}
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
