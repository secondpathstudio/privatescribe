// Import necessary modules and components
import { useState, useRef } from "react";
import CassetteSVG from "../neo/cassette";
import { Circle, Pause, Save } from "lucide-react";
import NeoButton from "../neo/neo-button";

// Maps a getUserMedia rejection to a clear, actionable message. getUserMedia
// rejects with a DOMException whose `name` identifies the cause.
function describeMicError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Microphone access was denied. Allow it for PrivateScribe in System Settings → Privacy & Security → Microphone, then try again.";
    case "NotFoundError":
      return "No microphone was found. Connect a microphone and try again.";
    case "NotReadableError":
      return "Your microphone could not be started — it may be in use by another app. Close other apps using it, then try again.";
    default:
      return "Could not access the microphone. Check your microphone connection and permissions, then try again.";
  }
}


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

  const startRecording = async () => {
    setError(null);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      // Most often the user denied the mic prompt, or access is turned off
      // in System Settings — without this the click silently does nothing.
      setError(describeMicError(err));
      return;
    }

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
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    
    setIsRecording(false);
  };

     
  return (
    <div className="flex flex-col justify-center w-full">
      <div className="w-full">
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