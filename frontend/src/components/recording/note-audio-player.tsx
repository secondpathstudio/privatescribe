import { API_BASE } from "@/lib/api";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useAuth } from '@/context/auth-context';

type Props = {
    noteId: string;
    /** Optional metadata for the download filename + size hint. */
    filename?: string | null;
    sizeBytes?: number | null;
    /**
     * Optional specific source recording to play. A note's transcript group
     * can hold several recordings (the original plus any appended ones); when
     * set, this streams that one via ?fileId=. Defaults to the original.
     */
    fileId?: string | null;
};

export type NoteAudioPlayerHandle = {
    /**
     * Seek playback to `seconds` and start playing. Pass `forFileId` when the
     * target belongs to a different source clip than the one currently loaded:
     * the parent switches this player's `fileId` to that clip and the seek is
     * deferred until the new clip finishes loading.
     */
    seek: (seconds: number, forFileId?: string | null) => void;
};

const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * Plays the encrypted source audio for a note. The endpoint requires a JWT
 * header, so we can't point <audio src> at it directly — instead we fetch
 * the full file once, build a blob URL, and hand that to <audio>. Memory
 * cost is roughly file size; up to the admin-configured upload cap.
 */
const NoteAudioPlayer = forwardRef<NoteAudioPlayerHandle, Props>(({ noteId, filename, sizeBytes, fileId }, ref) => {
    const auth = useAuth();
    const [blobUrl, setBlobUrl] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    // Track the URL we created so the cleanup effect revokes the right one
    // even if a re-render races with a new fetch.
    const createdUrlRef = useRef<string | null>(null);
    const audioRef = useRef<HTMLAudioElement>(null);
    // The fileId whose blob is currently loaded into <audio>. Lets seek() tell
    // "seek now" from "the parent is switching clips — wait for the load".
    const loadedFileIdRef = useRef<string | null | undefined>(undefined);
    // A seek requested before its clip finished loading; applied on load.
    const pendingSeekRef = useRef<number | null>(null);

    const playFrom = (el: HTMLAudioElement, seconds: number) => {
        el.currentTime = Math.max(0, seconds);
        // Autoplay restrictions: a same-task user gesture usually lets this
        // through. After a clip switch the play() happens off a load event
        // (a new task) and the browser may refuse — we then just leave the
        // playhead positioned and let the user hit play.
        const p = el.play();
        if (p && typeof p.catch === 'function') p.catch(() => { /* swallow */ });
    };

    // Apply a queued seek once the (possibly just-switched) clip can play.
    const applyPendingSeek = () => {
        const el = audioRef.current;
        if (el && pendingSeekRef.current != null) {
            const t = pendingSeekRef.current;
            pendingSeekRef.current = null;
            playFrom(el, t);
        }
    };

    useImperativeHandle(ref, () => ({
        seek: (seconds: number, forFileId?: string | null) => {
            const el = audioRef.current;
            const target = Math.max(0, seconds);
            const want = forFileId === undefined ? (fileId ?? null) : forFileId;
            // Seek immediately only when the wanted clip is the one already
            // loaded; otherwise queue it — the parent is switching `fileId`,
            // and applyPendingSeek fires when that clip's blob loads.
            if (el && loadedFileIdRef.current === want && el.readyState >= 1) {
                playFrom(el, target);
            } else {
                pendingSeekRef.current = target;
            }
        },
    }), [fileId]);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        setBlobUrl(null);

        // The audio endpoint can transiently fail at the network layer in the
        // moments right after a transcription run — Chromium reuses a pooled
        // keep-alive socket the backend has already closed, surfacing as a
        // thrown "Failed to fetch". Reopening the note always works, so a short
        // retry on network errors clears it. HTTP-status errors are
        // deterministic (404, 401, ...) and never retried.
        const MAX_ATTEMPTS = 3;
        const fetchAudio = async () => {
            for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
                try {
                    const endpoint = fileId
                        ? `${API_BASE}/api/notes/${noteId}/audio?fileId=${encodeURIComponent(fileId)}`
                        : `${API_BASE}/api/notes/${noteId}/audio`;
                    const response = await fetch(endpoint, {
                        headers: { Authorization: `Bearer ${auth.token}` },
                    });
                    if (!response.ok) {
                        const body = await response.json().catch(() => ({}));
                        throw new Error(body.error || `Audio fetch failed: ${response.status}`);
                    }
                    const blob = await response.blob();
                    if (cancelled) return;
                    const url = URL.createObjectURL(blob);
                    createdUrlRef.current = url;
                    loadedFileIdRef.current = fileId ?? null;
                    setBlobUrl(url);
                    setLoading(false);
                    return;
                } catch (e: unknown) {
                    if (cancelled) return;
                    // fetch() throws a TypeError only on a network-layer
                    // failure; an HTTP-status Error won't change on a retry.
                    if (e instanceof TypeError && attempt < MAX_ATTEMPTS) {
                        await new Promise((r) => setTimeout(r, attempt * 400));
                        if (cancelled) return;
                        continue;
                    }
                    setError(e instanceof Error ? e.message : 'Failed to load audio');
                    setLoading(false);
                    return;
                }
            }
        };

        fetchAudio();
        return () => {
            cancelled = true;
            if (createdUrlRef.current) {
                URL.revokeObjectURL(createdUrlRef.current);
                createdUrlRef.current = null;
            }
        };
    }, [noteId, auth.token, fileId]);

    if (loading) {
        return (
            <div className="flex items-center gap-2 border-2 border-black bg-white p-3 text-sm">
                <span className="inline-block h-3 w-3 border-2 border-black border-t-transparent rounded-full animate-spin" />
                Loading audio...
            </div>
        );
    }

    if (error) {
        return (
            <div className="border-2 border-black bg-yellow-100 p-3 text-sm">
                Couldn't load audio: {error}
            </div>
        );
    }

    if (!blobUrl) return null;

    return (
        <div className="flex flex-col gap-1 border-2 border-black bg-white p-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="truncate">
                    {filename || 'Source recording'}
                    {typeof sizeBytes === 'number' && sizeBytes > 0 && (
                        <span className="ml-2">({formatSize(sizeBytes)})</span>
                    )}
                </span>
                <a
                    href={blobUrl}
                    download={filename || `note-${noteId}-audio`}
                    className="underline ml-2"
                >
                    Download
                </a>
            </div>
            <audio
                ref={audioRef}
                controls
                src={blobUrl}
                onLoadedMetadata={applyPendingSeek}
                onCanPlay={applyPendingSeek}
                className="w-full"
            />
        </div>
    );
});

NoteAudioPlayer.displayName = 'NoteAudioPlayer';

export default NoteAudioPlayer;
