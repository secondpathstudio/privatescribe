// Import necessary modules and components
import { useEffect, useState, useRef } from "react";
import CassetteSVG from "../neo/cassette";
import { Circle, Pause, Save } from "lucide-react";
import NeoButton from "../neo/neo-button";
import {
  acquireRecordingStream,
  describeCaptureError,
  listMicrophones,
  systemAudioSupported,
  type AudioSourceMode,
} from "@/lib/audio-capture";

// Sentinel select value for the system-audio source (vs. a real mic deviceId).
const SYSTEM_AUDIO_VALUE = "__system_audio__";

  // Export the MicrophoneComponent function component
  export default function Microphone({
    onRecordingFinished,
    onPartialChunk,
    liveMode=false,
    disabled=false,
  } : {
    onRecordingFinished: (blob: Blob) => void;
    // Fired once per MediaRecorder timeslice when liveMode is on. Used by the
    // live transcription preview; the chunks are also accumulated for the
    // final onRecordingFinished blob, so this is purely additive.
    onPartialChunk?: (chunk: Blob) => void;
    // When true, MediaRecorder.start() is called with a 2000ms timeslice so
    // ondataavailable fires roughly every 2s instead of only on stop.
    liveMode?: boolean;
    disabled?: boolean;
  }) {
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder>(null);
  const [volumeLevel, setVolumeLevel] = useState(0);
  const isRecordingRef = useRef(false);
  const audioChunksRef = useRef<Blob[]>([]);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Audio source selection. `sourceMode` is mic vs. system audio; `micDeviceId`
  // is the chosen microphone (empty = default); `includeMic` mixes the mic in
  // when recording system audio (e.g. a teleconference). Tears down via the
  // captureCleanupRef on stop.
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [sourceMode, setSourceMode] = useState<AudioSourceMode>("mic");
  const [micDeviceId, setMicDeviceId] = useState<string>("");
  const [includeMic, setIncludeMic] = useState(true);
  const captureCleanupRef = useRef<(() => void) | null>(null);
  const systemSupported = systemAudioSupported();

  // Populate the microphone picker, refreshing on hotplug. Device labels are
  // empty until mic permission is granted once, so we also re-enumerate after
  // the first recording starts (see startRecording).
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      listMicrophones()
        .then((found) => {
          if (!cancelled) setMics(found);
        })
        .catch(() => undefined);
    };
    refresh();
    navigator.mediaDevices?.addEventListener?.("devicechange", refresh);
    return () => {
      cancelled = true;
      navigator.mediaDevices?.removeEventListener?.("devicechange", refresh);
    };
  }, []);

  const startRecording = async () => {
    setError(null);

    let capture: Awaited<ReturnType<typeof acquireRecordingStream>>;
    try {
      capture = await acquireRecordingStream({ sourceMode, micDeviceId, includeMic });
    } catch (err) {
      // Most often a denied permission prompt (mic, or Screen Recording for
      // system audio) — without this the click silently does nothing.
      setError(describeCaptureError(err, sourceMode));
      return;
    }
    const stream = capture.stream;
    captureCleanupRef.current = capture.cleanup;
    // Labels populate once permission is granted; refresh so the picker shows
    // real device names next time.
    listMicrophones().then(setMics).catch(() => undefined);

    mediaRecorderRef.current = new MediaRecorder(stream, {
      mimeType: 'audio/webm' // Change this to 'audio/wav' if you want WAV format
    });
    audioChunksRef.current = [];

    // Audio context for real-time analysis
    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256; // Change this value to increase or decrease the frequency resolution
    source.connect(analyser);

    // Get the frequency data
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const updateVolumeMeter = () => {
      analyser.getByteFrequencyData(dataArray);
      const peak = Math.max(...dataArray); // Peak volume
      // console.log('Peak volume:', peak);
      setVolumeLevel(peak);

      if (isRecordingRef.current) {
        requestAnimationFrame(updateVolumeMeter);
      }
    }

    // Start the volume meter
    isRecordingRef.current = true;
    updateVolumeMeter();

    mediaRecorderRef.current.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunksRef.current.push(event.data);
        if (liveMode) onPartialChunk?.(event.data);
      }
    };

    mediaRecorderRef.current.onstop = () => {
      const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' }); // Can also use 'audio/wav'
      setAudioBlob(audioBlob);
      console.log(audioBlob)
      onRecordingFinished(audioBlob);
      isRecordingRef.current = false;
      audioContext.close();
      // Stop the underlying mic/system tracks and close any mixing graph.
      captureCleanupRef.current?.();
      captureCleanupRef.current = null;
    };

    // 2s timeslice in liveMode so each chunk is small enough for the live
    // transcribe loop. Without a timeslice MediaRecorder buffers everything
    // until stop().
    mediaRecorderRef.current.start(liveMode ? 2000 : undefined);
    setIsRecording(true);
  };

  //pause recording
  const pauseRecording = () => {
    mediaRecorderRef.current?.pause();
    setPaused(true);
  };

  //resume recording
  const resumeRecording = () => {
    mediaRecorderRef.current?.resume();
    setPaused(false);
  };

  const stopRecording = () => {
    // stop() triggers onstop, which runs captureCleanupRef to stop the
    // underlying tracks — no need to stop the (possibly mixed) recorder
    // stream's tracks here.
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
  };

     
  return (
    <div className="flex flex-col justify-center w-full">
      <div className="w-full">
        {!audioBlob && (
          <div className="mb-4 flex flex-col gap-2 border-2 border-black bg-white p-3">
            <label className="text-sm font-semibold" htmlFor="audio-source">
              Audio source
            </label>
            <select
              id="audio-source"
              className="border-2 border-black bg-white p-2 text-sm disabled:opacity-50"
              value={sourceMode === "system" ? SYSTEM_AUDIO_VALUE : micDeviceId}
              disabled={isRecording || disabled}
              onChange={(e) => {
                const v = e.target.value;
                if (v === SYSTEM_AUDIO_VALUE) {
                  setSourceMode("system");
                } else {
                  setSourceMode("mic");
                  setMicDeviceId(v);
                }
              }}
            >
              <optgroup label="Microphone">
                <option value="">Default microphone</option>
                {mics
                  .filter((m) => m.deviceId && m.deviceId !== "default")
                  .map((m, i) => (
                    <option key={m.deviceId} value={m.deviceId}>
                      {m.label || `Microphone ${i + 1}`}
                    </option>
                  ))}
              </optgroup>
              {systemSupported && (
                <optgroup label="System">
                  <option value={SYSTEM_AUDIO_VALUE}>
                    System audio (this device's output)
                  </option>
                </optgroup>
              )}
            </select>
            {sourceMode === "system" && (
              <>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={includeMic}
                    disabled={isRecording || disabled}
                    onChange={(e) => setIncludeMic(e.target.checked)}
                  />
                  Also record my microphone
                </label>
                <p className="text-xs text-gray-600">
                  Captures the audio playing on this device (e.g. a meeting).
                  macOS will ask for Screen Recording permission the first time.
                </p>
              </>
            )}
          </div>
        )}
        <div className="flex flex-col items-center w-full">
          <div className="flex flex-col items-center w-full">
            <CassetteSVG
              isRecording={isRecording}
              paused={paused}
              labelText={
                isRecording && !paused
                  ? "Recording..."
                  : paused && !audioBlob
                  ? "Paused"
                  : paused && audioBlob
                  ? "Recording Finished"
                  : "Click to record"
              }
              className="w-1/3 h-1/3"
              volumeLevel={isRecording && volumeLevel || 0}
            />
          </div>
          {!audioBlob && (
          <div className="flex items-center justify-center gap-4 w-full">
            <NeoButton
              type='button'
              onClick={!isRecording ? startRecording : resumeRecording}
              disabled={(isRecording && !paused) || disabled}
            >
              <Circle className='fill-red-600' />
            </NeoButton>
            <NeoButton
              type="button"
              onClick={pauseRecording}
              disabled={!isRecording || paused || disabled}
              >
              <Pause className='fill-yellow-600' />
            </NeoButton>
            <NeoButton
              type="button"
              onClick={stopRecording}
              disabled={!isRecording || !paused || disabled}
              >
              <Save />
            </NeoButton>
          </div>
          )}
          {error && (
            <p role="alert" className="mt-3 text-center text-sm text-red-600">
              {error}
            </p>
          )}
        </div>
          {audioBlob && (
            <div className="mt-4 flex flex-col items-center w-full">
              Audio recording complete!
              <audio controls src={URL.createObjectURL(audioBlob)} className="w-full mt-5" />
            </div>
          )}
      </div>
    </div>
  );
}