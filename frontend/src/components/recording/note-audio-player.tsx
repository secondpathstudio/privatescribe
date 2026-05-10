import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/context/auth-context';

type Props = {
    noteId: string;
    /** Optional metadata for the download filename + size hint. */
    filename?: string | null;
    sizeBytes?: number | null;
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
const NoteAudioPlayer = ({ noteId, filename, sizeBytes }: Props) => {
    const auth = useAuth();
    const [blobUrl, setBlobUrl] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    // Track the URL we created so the cleanup effect revokes the right one
    // even if a re-render races with a new fetch.
    const createdUrlRef = useRef<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        setBlobUrl(null);

        const fetchAudio = async () => {
            try {
                const response = await fetch(`http://127.0.0.1:5000/api/notes/${noteId}/audio`, {
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
                setBlobUrl(url);
            } catch (e: unknown) {
                if (cancelled) return;
                setError(e instanceof Error ? e.message : 'Failed to load audio');
            } finally {
                if (!cancelled) setLoading(false);
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
    }, [noteId, auth.token]);

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
            <audio controls src={blobUrl} className="w-full" />
        </div>
    );
};

export default NoteAudioPlayer;
