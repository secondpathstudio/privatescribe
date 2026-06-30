import React from 'react';
import { MessageSquare, Pilcrow, Radio, Users } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import NeoButton from '@/components/neo/neo-button';
import NeoToggleIconButton from '@/components/neo/neo-toggle-icon-button';
import Microphone from '@/components/recording/microphone';
import LiveTranscript, { type LiveTranscriptHandle } from '@/components/transcription/LiveTranscript';

/** Capture settings the parent needs to build its /api/transcribe request. */
export type CaptureOptions = {
    /** Run pyannote speaker diarization on the final transcription pass. */
    diarize: boolean;
    /** Rewrite spoken dictation commands ("new paragraph", …) before the LLM. */
    applyDictationMarkers: boolean;
};

/** The file input's accept list. Browsers don't always set a MIME type for less
 *  common audio (e.g. .m4a often shows up empty), so dropped files are also
 *  matched by extension below. */
const AUDIO_ACCEPT = 'audio/*,video/*,.m4a,.mp3,.wav,.webm,.mp4,.ogg,.flac,.aac';
const AUDIO_EXTS = ['.m4a', '.mp3', '.wav', '.webm', '.mp4', '.ogg', '.flac', '.aac', '.mov', '.mkv'];

const isAudioOrVideoFile = (file: File): boolean => {
    if (file.type.startsWith('audio/') || file.type.startsWith('video/')) return true;
    const name = file.name.toLowerCase();
    return AUDIO_EXTS.some((ext) => name.endsWith(ext));
};

type AudioCaptureProps = {
    /** JWT for the live-transcript ticks. */
    authToken: string | null;
    /** True while the parent's transcription pipeline is running. */
    busy: boolean;
    /** Extra gate on recording/uploading (create flow: no template selected). */
    disabled?: boolean;
    /** Banner rendered under the tabs while gated (e.g. "pick a template first"). */
    disabledNotice?: React.ReactNode;
    /** Show the dictation-commands toggle (admin-enabled). */
    showDictationToggle?: boolean;
    /** Initial state of the diarization toggle. */
    defaultDiarize?: boolean;
    /** Initial state of the dictation-markers toggle. */
    defaultApplyDictationMarkers?: boolean;
    /** Bump to reset the recorder and clear any staged upload (e.g. after save). */
    resetSignal?: number;
    /** Fired when audio is ready — a stopped recording or a chosen upload. The
     *  parent runs its own transcribe → downstream pipeline with `opts`. */
    onAudio: (blob: Blob, filename: string, opts: CaptureOptions) => void;
};

/**
 * The audio-capture experience shared by the create-note flow (NewNoteForm) and
 * the append-recording flow (SingleNoteForm): the diarize / dictation / live
 * toggles, the Record/Upload tabs, the Microphone + rolling LiveTranscript, the
 * upload picker, and page-level drag-and-drop. Capture and its settings live
 * here; each parent supplies `onAudio` and owns the downstream pipeline (create
 * → save new note; append → merge → reformat → save).
 */
const AudioCapture = ({
    authToken,
    busy,
    disabled = false,
    disabledNotice,
    showDictationToggle = false,
    defaultDiarize = false,
    defaultApplyDictationMarkers = false,
    resetSignal = 0,
    onAudio,
}: AudioCaptureProps) => {
    // Capture settings. diarize/applyDictationMarkers feed the final pass via
    // onAudio; liveTranscript/liveDiarize only drive the rolling preview.
    const [diarize, setDiarize] = React.useState(defaultDiarize);
    const [applyDictationMarkers, setApplyDictationMarkers] = React.useState(defaultApplyDictationMarkers);
    const [liveTranscript, setLiveTranscript] = React.useState(false);
    const [liveDiarize, setLiveDiarize] = React.useState(false);

    // Append-only buffer of MediaRecorder timeslice chunks. LiveTranscript owns
    // a cursor into this array; we never mutate or shrink existing entries so
    // its cursor stays valid.
    const [liveChunks, setLiveChunks] = React.useState<Blob[]>([]);
    const liveTranscriptRef = React.useRef<LiveTranscriptHandle | null>(null);

    // File-upload-as-source state. Distinct from the Microphone path so the
    // user can preview before kicking off transcription.
    const [uploadedFile, setUploadedFile] = React.useState<File | null>(null);
    const [uploadedAudioUrl, setUploadedAudioUrl] = React.useState<string | null>(null);
    const fileInputRef = React.useRef<HTMLInputElement>(null);

    // Controlled tab so a page-level drop can flip to Upload regardless of which
    // tab the user was on. micKey re-keys <Microphone> on reset (fresh blob).
    const [activeTab, setActiveTab] = React.useState<'record' | 'upload'>('record');
    const [micKey, setMicKey] = React.useState(0);

    const [dropOverlay, setDropOverlay] = React.useState(false);
    const [dropError, setDropError] = React.useState<string | null>(null);
    // Counter rather than a boolean: dragenter/dragleave fire as the cursor
    // crosses descendant elements, so we increment/decrement to know when the
    // drag has truly left the window.
    const dragDepthRef = React.useRef(0);
    // Read inside the window-level drag listeners (bound once), so a ref instead
    // of state keeps the in-flight `busy` check current without re-binding.
    const busyRef = React.useRef(busy);
    busyRef.current = busy;

    // Free the object URL when the staged file changes/unmounts to avoid leaks.
    React.useEffect(() => {
        return () => {
            if (uploadedAudioUrl) URL.revokeObjectURL(uploadedAudioUrl);
        };
    }, [uploadedAudioUrl]);

    // Reset the recorder + any staged upload when the parent bumps resetSignal
    // (e.g. after a successful save). Skips the initial mount.
    const firstReset = React.useRef(true);
    React.useEffect(() => {
        if (firstReset.current) {
            firstReset.current = false;
            return;
        }
        setMicKey((k) => k + 1);
        setLiveChunks([]);
        setUploadedAudioUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return null;
        });
        setUploadedFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
    }, [resetSignal]);

    const handleFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (uploadedAudioUrl) URL.revokeObjectURL(uploadedAudioUrl);
        setUploadedFile(file);
        setUploadedAudioUrl(URL.createObjectURL(file));
    };

    const ingestDroppedFile = (file: File) => {
        if (!isAudioOrVideoFile(file)) {
            setDropError(`"${file.name}" doesn't look like an audio or video file.`);
            return;
        }
        if (uploadedAudioUrl) URL.revokeObjectURL(uploadedAudioUrl);
        setUploadedFile(file);
        setUploadedAudioUrl(URL.createObjectURL(file));
        setActiveTab('upload');
        setDropError(null);
    };

    // Window-level drag handlers so dropping anywhere on the page stages the
    // upload file. Bound once on mount; reads `busy` through a ref so an
    // in-flight transcription can short-circuit drops without re-binding.
    React.useEffect(() => {
        const isFileDrag = (e: DragEvent) =>
            Array.from(e.dataTransfer?.types ?? []).includes('Files');

        const onDragEnter = (e: DragEvent) => {
            if (!isFileDrag(e)) return;
            e.preventDefault();
            if (busyRef.current) return;
            dragDepthRef.current += 1;
            if (dragDepthRef.current === 1) setDropOverlay(true);
        };
        const onDragOver = (e: DragEvent) => {
            if (!isFileDrag(e)) return;
            // preventDefault is what makes the element a valid drop target;
            // without it the browser falls back to "open the file" behavior.
            e.preventDefault();
        };
        const onDragLeave = (e: DragEvent) => {
            if (!isFileDrag(e)) return;
            dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
            if (dragDepthRef.current === 0) setDropOverlay(false);
        };
        const onDrop = (e: DragEvent) => {
            if (!isFileDrag(e)) return;
            e.preventDefault();
            dragDepthRef.current = 0;
            setDropOverlay(false);
            if (busyRef.current) {
                setDropError('A transcription is already in progress — wait for it to finish before uploading another file.');
                return;
            }
            const file = e.dataTransfer?.files?.[0];
            if (!file) return;
            ingestDroppedFile(file);
        };

        window.addEventListener('dragenter', onDragEnter);
        window.addEventListener('dragover', onDragOver);
        window.addEventListener('dragleave', onDragLeave);
        window.addEventListener('drop', onDrop);
        return () => {
            window.removeEventListener('dragenter', onDragEnter);
            window.removeEventListener('dragover', onDragOver);
            window.removeEventListener('dragleave', onDragLeave);
            window.removeEventListener('drop', onDrop);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const clearUploadedFile = () => {
        if (uploadedAudioUrl) URL.revokeObjectURL(uploadedAudioUrl);
        setUploadedFile(null);
        setUploadedAudioUrl(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    return (
        <>
            {/* Pre-transcription options. The shadows on these buttons extend
                8px down-right when "off", so pb-3 keeps them off the tabs. */}
            <div className="flex flex-row flex-wrap items-end gap-6 mt-4 pb-3">
                <NeoToggleIconButton
                    icon={Users}
                    label="Speaker Diarization"
                    title="Identify speakers (diarize)"
                    on={diarize}
                    onToggle={setDiarize}
                    disabled={busy}
                />
                {showDictationToggle && (
                    <NeoToggleIconButton
                        icon={Pilcrow}
                        label="Punctuation Commands"
                        title='Apply dictation commands ("new paragraph", "period", "comma", "new line")'
                        on={applyDictationMarkers}
                        onToggle={setApplyDictationMarkers}
                        disabled={busy}
                    />
                )}
                {/* Best-effort rolling preview while recording. The
                    authoritative transcript still comes from /api/transcribe. */}
                <NeoToggleIconButton
                    icon={Radio}
                    label="Live Transcript"
                    title="Show a rolling transcript while recording (applies on next recording)"
                    on={liveTranscript}
                    onToggle={setLiveTranscript}
                    disabled={busy}
                />
                {/* Nested under Live Transcript — diarizing every tick is heavy.
                    Always rendered but disabled until Live Transcript is on, so
                    there's no mount/unmount jank. */}
                <NeoToggleIconButton
                    icon={MessageSquare}
                    label="Live Speakers"
                    title={
                        liveTranscript
                            ? 'Run speaker diarization on each live tick (CPU-heavy)'
                            : 'Enable Live Transcript first'
                    }
                    on={liveDiarize && liveTranscript}
                    onToggle={setLiveDiarize}
                    disabled={busy || !liveTranscript}
                    activeColor="#2563eb"
                />
            </div>

            {/* Audio source: live recording vs. file upload. Both feed onAudio(). */}
            <Tabs
                value={activeTab}
                onValueChange={(v) => setActiveTab(v as 'record' | 'upload')}
                className="w-full mt-4"
            >
                <TabsList className="flex w-full">
                    <TabsTrigger className="grow" value="record">Record</TabsTrigger>
                    <TabsTrigger className="grow" value="upload">Upload</TabsTrigger>
                </TabsList>

                {disabled && disabledNotice}

                <TabsContent value="record">
                    <div className="flex justify-between items-center mt-4">
                        <Microphone
                            key={micKey}
                            onRecordingFinished={(blob) => {
                                // Fire-and-forget the live session cleanup; the
                                // real transcribe call is what matters.
                                liveTranscriptRef.current?.finalize();
                                onAudio(blob, 'recording.webm', { diarize, applyDictationMarkers });
                            }}
                            onPartialChunk={
                                liveTranscript
                                    ? (chunk) => setLiveChunks((prev) => [...prev, chunk])
                                    : undefined
                            }
                            liveMode={liveTranscript}
                            disabled={disabled}
                        />
                    </div>
                    {liveTranscript && (
                        <LiveTranscript
                            ref={liveTranscriptRef}
                            chunks={liveChunks}
                            diarize={liveDiarize}
                            authToken={authToken}
                        />
                    )}
                </TabsContent>

                <TabsContent value="upload">
                    <div className="flex flex-col items-center w-full mt-4 gap-3">
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept={AUDIO_ACCEPT}
                            onChange={handleFilePicked}
                            disabled={busy || disabled}
                            className="hidden"
                        />
                        {!uploadedFile ? (
                            <NeoButton
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={busy || disabled}
                            >
                                Choose audio file
                            </NeoButton>
                        ) : (
                            <div className="flex flex-col items-center w-full gap-2">
                                <div className="text-sm">
                                    <span className="font-semibold">{uploadedFile.name}</span>
                                    {' '}({(uploadedFile.size / (1024 * 1024)).toFixed(1)} MB)
                                </div>
                                {uploadedAudioUrl && (
                                    <audio controls src={uploadedAudioUrl} className="w-full" />
                                )}
                                <div className="flex gap-2">
                                    <NeoButton
                                        type="button"
                                        onClick={() => {
                                            if (uploadedFile) {
                                                onAudio(uploadedFile, uploadedFile.name, {
                                                    diarize,
                                                    applyDictationMarkers,
                                                });
                                            }
                                        }}
                                        disabled={busy || disabled}
                                    >
                                        Transcribe this file
                                    </NeoButton>
                                    <NeoButton
                                        type="button"
                                        onClick={clearUploadedFile}
                                        disabled={busy}
                                    >
                                        Choose a different file
                                    </NeoButton>
                                </div>
                            </div>
                        )}
                        <p className="text-xs text-gray-600 text-center max-w-md">
                            Supports common audio formats (mp3, m4a, wav, webm, ogg, flac) and video files
                            (audio track is extracted). Large files may take a while to transcribe.
                        </p>
                    </div>
                </TabsContent>
            </Tabs>

            {dropOverlay && (
                <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-[#fd3777]/15 border-[6px] border-dashed border-[#fd3777]">
                    <div className="border-[3px] border-black bg-white px-8 py-4 shadow-[6px_6px_0_0_#000]">
                        <p className="text-2xl font-black uppercase tracking-wide text-[#5d1d91]">
                            Drop audio/video to upload
                        </p>
                        <p className="text-xs text-gray-700 mt-1">
                            File will be staged in the Upload tab — then hit Transcribe.
                        </p>
                    </div>
                </div>
            )}

            {dropError && (
                <div className="fixed bottom-4 right-4 z-40 max-w-sm border-[2px] border-black bg-red-50 p-3 text-sm text-red-700 shadow-[4px_4px_0_0_#000]">
                    <div className="flex justify-between gap-3">
                        <span>{dropError}</span>
                        <button
                            type="button"
                            onClick={() => setDropError(null)}
                            className="font-black"
                        >
                            ✕
                        </button>
                    </div>
                </div>
            )}
        </>
    );
};

export default AudioCapture;
