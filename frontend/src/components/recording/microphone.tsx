// Import necessary modules and components
import { useEffect, useState, useRef } from "react";
import { Button } from '@/components/ui/button';
import VolumeMeter from "./volume-meter";

  
  // Export the MicrophoneComponent function component
  export default function Microphone({ 
    onRecordingFinished,
    
  } : { 
    onRecordingFinished: (blob: Blob) => void 
    
  }) {
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder>(null);
  const [volumeLevel, setVolumeLevel] = useState(0);
  const isRecordingRef = useRef(false);
  const audioChunksRef = useRef<Blob[]>([]);
  const [paused, setPaused] = useState(false);

  const startRecording = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

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

    mediaRecorderRef.current.start();
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
        <div className="flex items-center w-full">
          {!isRecording && (
            // Button for start recording
            <Button
              type='button'
              onClick={startRecording}
              className="text-white gap-2 m-auto flex items-center justify-center bg-blue-400 hover:bg-blue-500 w-60 h-10 focus:outline-none rounded-lg"
            >
              Start Recording
              {/* SVG icon for microphone */}
              <svg
                viewBox="0 0 256 256"
                xmlns="http://www.w3.org/2000/svg"
                className="w-6 h-6 text-white"
              >
                <path
                  fill="currentColor" // Change fill color to the desired color
                  d="M128 176a48.05 48.05 0 0 0 48-48V64a48 48 0 0 0-96 0v64a48.05 48.05 0 0 0 48 48ZM96 64a32 32 0 0 1 64 0v64a32 32 0 0 1-64 0Zm40 143.6V232a8 8 0 0 1-16 0v-24.4A80.11 80.11 0 0 1 48 128a8 8 0 0 1 16 0a64 64 0 0 0 128 0a8 8 0 0 1 16 0a80.11 80.11 0 0 1-72 79.6Z"
                />
              </svg>
            </Button>
          )}
          {isRecording && !paused && (
            // Button for pause recording
            <div className="flex flex-col items-center w-full">
              <div className="text-center">Recording...</div>
              <VolumeMeter volumeLevel={volumeLevel} />
              <Button
                type="button"
                onClick={pauseRecording}
                className="text-white gap-2 m-auto flex items-center justify-center bg-red-400 hover:bg-red-500 w-60 h-10 focus:outline-none rounded-lg"
                >
                Pause Recording
              </Button>
            </div>
          )}
          {isRecording && paused && (
            // Button for resume recording
            <div className="flex flex-col items-center w-full">
              <div className="text-center animate-pulse">Recording paused...</div>
              <div className="flex items-center justify-center gap-2 w-full">
                <Button
                  type="button"
                  onClick={resumeRecording}
                  className="text-white gap-2 m-auto flex items-center justify-center bg-green-400 hover:bg-green-500 w-60 h-10 focus:outline-none rounded-lg"
                  >
                  Resume Recording
                </Button>
                <Button
                  type="button"
                  onClick={stopRecording}
                  className="text-white gap-2 m-auto flex items-center justify-center bg-red-400 hover:bg-red-500 w-60 h-10 focus:outline-none rounded-lg"
                  >
                  End Recording
                </Button>
              </div>
            </div>
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