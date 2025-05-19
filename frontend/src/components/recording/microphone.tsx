// Import necessary modules and components
import { useEffect, useState, useRef } from "react";
import CassetteSVG from "../neo/cassette";
import { Circle, Pause, Save } from "lucide-react";
import NeoButton from "../neo/neo-button";

  
  // Export the MicrophoneComponent function component
  export default function Microphone({ 
    onRecordingFinished,
    disabled=false,
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