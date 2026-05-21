// Audio capture helpers shared by the recording UI. Centralizes the two
// capture paths — a chosen microphone, or the device's system/output audio
// (desktop app only) optionally mixed with the mic for teleconference notes.

export type AudioSourceMode = "mic" | "system";

export interface CaptureOptions {
  sourceMode: AudioSourceMode;
  /** Selected microphone deviceId; falls back to the default input when unset. */
  micDeviceId?: string;
  /** When sourceMode is "system", also mix the microphone into the recording. */
  includeMic: boolean;
}

export interface CaptureResult {
  /** Feed this to MediaRecorder and the volume analyser. */
  stream: MediaStream;
  /** Stops every underlying track and tears down the mixing graph. */
  cleanup: () => void;
}

/**
 * System (output) audio capture is only offered in the Electron desktop app,
 * where the main process grants loopback audio via setDisplayMediaRequestHandler.
 * In a plain browser getDisplayMedia would force a screen-share prompt and is
 * unreliable on macOS, so we hide the option there entirely.
 */
export function systemAudioSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.electron &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getDisplayMedia
  );
}

/** Audio input devices for the microphone picker. Labels are empty until the
 *  user has granted mic permission at least once, so callers should fall back
 *  to a generic name. */
export async function listMicrophones(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === "audioinput");
}

async function getMicStream(deviceId?: string): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: deviceId ? { deviceId: { exact: deviceId } } : true,
  });
}

/**
 * Builds the MediaStream to record from. For "mic" this is the raw input
 * stream. For "system" we acquire the display-media stream (granted loopback
 * audio by the Electron main process), discard its video track, and — when
 * includeMic is set — mix the microphone in through an AudioContext so the
 * recording carries both sides of a call.
 */
export async function acquireRecordingStream(
  opts: CaptureOptions,
): Promise<CaptureResult> {
  if (opts.sourceMode === "mic") {
    const stream = await getMicStream(opts.micDeviceId);
    return {
      stream,
      cleanup: () => stream.getTracks().forEach((t) => t.stop()),
    };
  }

  const display = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: true,
  });
  // We only want the audio — the screen video is just the carrier the OS
  // requires for loopback capture, so stop it immediately.
  display.getVideoTracks().forEach((t) => t.stop());
  const systemAudio = display.getAudioTracks();
  if (systemAudio.length === 0) {
    display.getTracks().forEach((t) => t.stop());
    throw new DOMException(
      "No system audio was captured.",
      "NotFoundError",
    );
  }

  let micStream: MediaStream | null = null;
  if (opts.includeMic) {
    try {
      micStream = await getMicStream(opts.micDeviceId);
    } catch (err) {
      // The user explicitly asked to include their mic, so don't silently
      // record a meeting missing their own voice — fail and let them retry.
      display.getTracks().forEach((t) => t.stop());
      throw err;
    }
  }

  const ctx = new AudioContext();
  const destination = ctx.createMediaStreamDestination();
  ctx.createMediaStreamSource(new MediaStream(systemAudio)).connect(destination);
  if (micStream) {
    ctx.createMediaStreamSource(micStream).connect(destination);
  }

  return {
    stream: destination.stream,
    cleanup: () => {
      display.getTracks().forEach((t) => t.stop());
      micStream?.getTracks().forEach((t) => t.stop());
      void ctx.close();
    },
  };
}

/** Maps a capture rejection to a clear, actionable message. The relevant
 *  permission differs by source: microphone vs. screen recording (which gates
 *  system-audio loopback on macOS). */
export function describeCaptureError(
  err: unknown,
  sourceMode: AudioSourceMode,
): string {
  const name = err instanceof DOMException ? err.name : "";
  if (sourceMode === "system") {
    switch (name) {
      case "NotAllowedError":
      case "SecurityError":
        return "Screen Recording permission is needed to capture system audio. Allow it for PrivateScribe in System Settings → Privacy & Security → Screen Recording, then try again.";
      case "NotFoundError":
        return "No system audio was captured. Make sure something is playing audio, then try again.";
      default:
        return "Could not capture system audio. Check PrivateScribe's Screen Recording permission and try again.";
    }
  }
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
