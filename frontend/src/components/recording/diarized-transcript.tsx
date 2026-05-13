export type TranscriptSegment = {
  speaker: string;
  start: number;
  end: number;
  text: string;
};

type Props = {
  segments: TranscriptSegment[];
  /**
   * Called when a timestamp chip is clicked. Receives the segment's start
   * time in seconds. If omitted, chips render but are disabled — useful in
   * pre-save contexts where no audio player exists yet.
   */
  onSeek?: (seconds: number) => void;
  className?: string;
};

const formatTimestamp = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

/**
 * Renders a diarized transcript as a list of speaker-labeled turns with
 * clickable timestamp chips. Clicking a chip calls `onSeek(start)`, which
 * the parent typically wires into an audio player's currentTime.
 */
const DiarizedTranscript = ({ segments, onSeek, className }: Props) => {
  const seekable = typeof onSeek === 'function';
  return (
    <div
      className={`border-2 border-black bg-white p-3 max-h-96 overflow-y-auto ${className ?? ''}`}
    >
      {segments.map((s, i) => (
        <div key={i} className="mb-3 last:mb-0">
          <div className="flex items-baseline gap-2 mb-1 flex-wrap">
            <button
              type="button"
              onClick={() => onSeek?.(s.start)}
              disabled={!seekable}
              className="font-mono text-xs px-2 py-0.5 border border-black bg-[#fd3777] text-white hover:bg-[#2b0f54] disabled:opacity-50 disabled:cursor-default transition-colors"
              title={seekable ? 'Jump to this moment in the audio' : undefined}
            >
              {formatTimestamp(s.start)}
            </button>
            <span className="font-semibold text-[#fd3777]">{s.speaker}</span>
          </div>
          <div className="text-sm pl-1 leading-snug">{s.text}</div>
        </div>
      ))}
    </div>
  );
};

export default DiarizedTranscript;
