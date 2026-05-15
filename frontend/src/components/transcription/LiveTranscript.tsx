import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";
import { API_BASE } from "@/lib/api";

export type LiveSegment = {
  speaker: string | null;
  start: number;
  end: number;
  text: string;
};

type LiveResponse = {
  session_id: string;
  committed: LiveSegment[];
  interim: LiveSegment[];
  total_duration: number;
};

export type LiveTranscriptHandle = {
  // Called by the parent after recording stops so the server can free the
  // per-session temp file. No-ops if there's no active session.
  finalize: () => Promise<void>;
};

type Props = {
  // Append-only list of MediaRecorder timeslice chunks. The component
  // tracks which ones it's already POSTed via a cursor ref so the parent
  // can keep this array purely additive.
  chunks: Blob[];
  // Whether to ask the server to also run pyannote diarization on each tick.
  // Heavy — only pass true when the user has opted in. Locked while
  // recording so the value can't change mid-session (the server has no
  // upgrade path for retroactively labeling committed speaker=null
  // segments).
  diarize: boolean;
  authToken: string | null;
};

/**
 * Renders a rolling live transcript built from /api/transcribe/live ticks.
 *
 * Two visual tiers:
 *   - committed segments render solid; they won't change on future ticks
 *   - interim segments render dimmed/italic; they sit inside the trailing
 *     ~20s of audio and can still be revised
 *
 * Concurrency: at most one /api/transcribe/live request is in flight at a
 * time. If new chunks arrive while a request is open, a flag is set and a
 * follow-up tick fires when the current one resolves — so we never queue
 * up a backlog of overlapping requests at the server.
 */
const LiveTranscript = forwardRef<LiveTranscriptHandle, Props>(function LiveTranscript(
  { chunks, diarize, authToken },
  ref
) {
  const [committed, setCommitted] = useState<LiveSegment[]>([]);
  const [interim, setInterim] = useState<LiveSegment[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Cursor into `chunks`: index of the first chunk we haven't sent yet.
  const cursorRef = useRef(0);
  const sessionIdRef = useRef<string | null>(null);
  const inflightRef = useRef(false);
  const pendingRef = useRef(false);

  useImperativeHandle(
    ref,
    () => ({
      finalize: async () => {
        const sid = sessionIdRef.current;
        if (!sid) return;
        sessionIdRef.current = null;
        try {
          await fetch(`${API_BASE}/api/transcribe/live/finalize`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
            },
            body: JSON.stringify({ session_id: sid }),
          });
        } catch (e) {
          // Best-effort cleanup; TTL on the server will reap stragglers.
          console.warn("Live finalize failed:", e);
        }
      },
    }),
    [authToken]
  );

  useEffect(() => {
    if (chunks.length <= cursorRef.current) return;

    const tick = async () => {
      if (inflightRef.current) {
        pendingRef.current = true;
        return;
      }
      inflightRef.current = true;
      pendingRef.current = false;

      // Snapshot the cursor BEFORE the await; everything from here up to
      // the current length goes in this request. Bundling multiple
      // queued chunks into one POST keeps us from falling behind when
      // the server is slower than 2s/tick.
      const from = cursorRef.current;
      const to = chunks.length;
      cursorRef.current = to;

      try {
        const slice = chunks.slice(from, to);
        const blob = new Blob(slice, { type: "audio/webm" });
        const fd = new FormData();
        fd.append("chunk", blob, "chunk.webm");
        fd.append("diarize", diarize ? "true" : "false");
        if (sessionIdRef.current) fd.append("session_id", sessionIdRef.current);

        const resp = await fetch(`${API_BASE}/api/transcribe/live`, {
          method: "POST",
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
          body: fd,
        });
        if (!resp.ok) {
          setError(`Live transcribe HTTP ${resp.status}`);
          return;
        }
        const data: LiveResponse = await resp.json();
        sessionIdRef.current = data.session_id;
        setCommitted(data.committed);
        setInterim(data.interim);
        setError(null);
      } catch (e) {
        console.warn("Live transcribe error:", e);
        setError("Live transcribe unavailable");
      } finally {
        inflightRef.current = false;
        if (pendingRef.current) {
          // New chunks arrived while we were busy; run again immediately.
          tick();
        }
      }
    };
    tick();
  }, [chunks, chunks.length, diarize, authToken]);

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const r = Math.floor(s % 60);
    return `${m}:${r.toString().padStart(2, "0")}`;
  };

  const hasAny = committed.length > 0 || interim.length > 0;

  return (
    <div className="mt-4 border-2 border-black bg-white p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-black uppercase tracking-wider">
          Live transcript
        </h3>
        <span className="text-[10px] uppercase tracking-wider text-gray-500">
          {diarize ? "with speakers" : "text only"}
        </span>
      </div>
      <div className="max-h-72 overflow-y-auto font-mono text-sm space-y-1">
        {!hasAny && !error && (
          <p className="text-gray-400 italic">Waiting for speech…</p>
        )}
        {error && (
          <p className="text-red-600 text-xs italic">{error}</p>
        )}
        {committed.map((s, i) => (
          <p key={`c-${i}-${s.start.toFixed(2)}`} className="leading-snug">
            {s.speaker && (
              <span className="font-bold mr-2">{s.speaker}:</span>
            )}
            <span className="text-gray-500 text-[10px] mr-2 tabular-nums">
              [{fmt(s.start)}]
            </span>
            <span>{s.text}</span>
          </p>
        ))}
        {interim.map((s, i) => (
          <p
            key={`i-${i}-${s.start.toFixed(2)}`}
            className="leading-snug opacity-50 italic"
          >
            {s.speaker && (
              <span className="font-bold mr-2">{s.speaker}:</span>
            )}
            <span className="text-gray-500 text-[10px] mr-2 tabular-nums">
              [{fmt(s.start)}]
            </span>
            <span>{s.text}</span>
          </p>
        ))}
      </div>
    </div>
  );
});

export default LiveTranscript;
