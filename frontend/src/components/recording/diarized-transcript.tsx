import { useMemo, useState } from 'react';

export type TranscriptSegment = {
  speaker: string;
  start: number;
  end: number;
  text: string;
};

/**
 * Manual speaker->identity map, layered over the raw diarization output.
 * Keys are the raw "Speaker N" labels; participantId links a saved contact
 * (null for a free-text name). Mirrors the backend Note.speaker_labels shape.
 */
export type SpeakerLabels = Record<
  string,
  { participantId: string | null; name: string }
>;

export type LabelParticipant = {
  id: string;
  firstName: string;
  lastName?: string | null;
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
  /** Current speaker->identity assignments. Absent speakers show as "Speaker N". */
  speakerLabels?: SpeakerLabels;
  /** Saved contacts offered as datalist suggestions. Free text is still allowed. */
  participants?: LabelParticipant[];
  /** When true (and onAssign is set), an assignment panel renders above the turns. */
  editable?: boolean;
  /**
   * Commit a speaker assignment. `value` is null when the field is cleared,
   * which drops the label so the turn falls back to its raw "Speaker N".
   */
  onAssign?: (
    rawSpeaker: string,
    value: { participantId: string | null; name: string } | null,
  ) => void;
};

const formatTimestamp = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const participantName = (p: LabelParticipant) =>
  `${p.firstName} ${p.lastName ?? ''}`.trim();

/**
 * One free-text input (with contact suggestions) for a single raw speaker.
 * Local state holds the in-progress text; the assignment is committed to the
 * parent on blur or Enter so editing doesn't fire a request per keystroke.
 */
const SpeakerAssignment = ({
  rawSpeaker,
  current,
  participants,
  onAssign,
  listId,
}: {
  rawSpeaker: string;
  current?: { participantId: string | null; name: string };
  participants: LabelParticipant[];
  onAssign: NonNullable<Props['onAssign']>;
  listId: string;
}) => {
  const [draft, setDraft] = useState(current?.name ?? '');

  const commit = () => {
    const name = draft.trim();
    if (!name) {
      if (current) onAssign(rawSpeaker, null);
      return;
    }
    if (name === current?.name) return; // unchanged — skip the request
    // Match against a saved contact to keep the participantId link; an
    // unmatched name is committed as free text (participantId null).
    const match = participants.find(
      (p) => participantName(p).toLowerCase() === name.toLowerCase(),
    );
    onAssign(rawSpeaker, { participantId: match?.id ?? null, name });
  };

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="font-mono text-xs px-2 py-0.5 border border-black bg-[#2b0f54] text-white whitespace-nowrap">
        {rawSpeaker}
      </span>
      <span aria-hidden>→</span>
      <input
        type="text"
        list={listId}
        value={draft}
        placeholder="Name this speaker…"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        className="border-2 border-black px-2 py-0.5 text-sm flex-1 min-w-0"
      />
    </label>
  );
};

/**
 * Renders a diarized transcript as a list of speaker-labeled turns with
 * clickable timestamp chips. Clicking a chip calls `onSeek(start)`, which
 * the parent typically wires into an audio player's currentTime.
 *
 * When `editable` and `onAssign` are supplied, an assignment panel above the
 * turns lets the user name each raw speaker (picking a saved contact or
 * typing a free-text name); the turns then display the assigned names.
 */
const DiarizedTranscript = ({
  segments,
  onSeek,
  className,
  speakerLabels,
  participants = [],
  editable = false,
  onAssign,
}: Props) => {
  const seekable = typeof onSeek === 'function';
  const showPanel = editable && typeof onAssign === 'function';

  // Unique raw speakers in order of first appearance — the rows of the panel.
  const rawSpeakers = useMemo(() => {
    const seen: string[] = [];
    for (const s of segments) {
      if (!seen.includes(s.speaker)) seen.push(s.speaker);
    }
    return seen;
  }, [segments]);

  const resolve = (raw: string) => speakerLabels?.[raw]?.name ?? raw;

  return (
    <div className={className}>
      {showPanel && rawSpeakers.length > 0 && (
        <div className="border-2 border-black bg-[#fef7e5] p-3 mb-2">
          <div className="font-semibold text-sm mb-2">Assign speakers</div>
          <datalist id="diarized-transcript-participants">
            {participants.map((p) => (
              <option key={p.id} value={participantName(p)} />
            ))}
          </datalist>
          <div className="flex flex-col gap-2">
            {rawSpeakers.map((raw) => (
              <SpeakerAssignment
                key={raw}
                rawSpeaker={raw}
                current={speakerLabels?.[raw]}
                participants={participants}
                onAssign={onAssign!}
                listId="diarized-transcript-participants"
              />
            ))}
          </div>
        </div>
      )}
      <div className="border-2 border-black bg-white p-3 max-h-96 overflow-y-auto">
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
              <span className="font-semibold text-[#fd3777]">
                {resolve(s.speaker)}
              </span>
            </div>
            <div className="text-sm pl-1 leading-snug">{s.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default DiarizedTranscript;
