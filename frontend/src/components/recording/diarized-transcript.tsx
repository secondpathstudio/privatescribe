import { useEffect, useMemo, useRef, useState } from 'react';

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
  /**
   * Commit an edited segment list. Text edits, splits (Enter), merges
   * (Backspace at a line's start), and per-turn speaker changes all flow
   * through here as a full replacement array. When set (and editable),
   * every turn renders as an editable row.
   */
  onSegmentsChange?: (segments: TranscriptSegment[]) => void;
  /** Shows a subtle "Saving…" hint while an edit is being persisted. */
  saving?: boolean;
};

/** Sentinel <option> value for "add a speaker the diarization missed". */
const NEW_SPEAKER = '__new_speaker__';

const formatTimestamp = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const participantName = (p: LabelParticipant) =>
  `${p.firstName} ${p.lastName ?? ''}`.trim();

/** Resize a textarea to fit its content — turns have no fixed line count. */
const autoGrow = (el: HTMLTextAreaElement) => {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
};

/**
 * One free-text input (with contact suggestions) for a single raw speaker.
 * Local state holds the in-progress text; the assignment is committed to the
 * parent on blur or Enter so editing doesn't fire a request per keystroke.
 *
 * The raw-speaker chip is a button: clicking it steps through that speaker's
 * turns in the transcript below (via `onCycle`), so it's easy to see where a
 * given speaker talked — handy for spotting an over-split phantom speaker.
 */
const SpeakerAssignment = ({
  rawSpeaker,
  current,
  participants,
  onAssign,
  onCycle,
  turnCount,
  listId,
}: {
  rawSpeaker: string;
  current?: { participantId: string | null; name: string };
  participants: LabelParticipant[];
  onAssign: NonNullable<Props['onAssign']>;
  onCycle: () => void;
  turnCount: number;
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
      <button
        type="button"
        onClick={onCycle}
        title={`Jump through this speaker's ${turnCount} turn${
          turnCount === 1 ? '' : 's'
        } in the transcript below`}
        className="font-mono text-xs px-2 py-0.5 border border-black bg-[#2b0f54] text-white whitespace-nowrap hover:bg-[#fd3777] transition-colors"
      >
        {rawSpeaker}
      </button>
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
 *
 * When `editable` and `onSegmentsChange` are supplied, each turn becomes an
 * editable row: the text is directly editable, Enter splits a turn into a
 * new line at the caret, Backspace at a line's start merges it into the turn
 * above, and a per-turn speaker dropdown reassigns the turn — including to a
 * brand-new "Speaker N" the diarization missed. This is the fix for
 * diarization that over-split (or under-split) speakers during review.
 */
const DiarizedTranscript = ({
  segments,
  onSeek,
  className,
  speakerLabels,
  participants = [],
  editable = false,
  onAssign,
  onSegmentsChange,
  saving = false,
}: Props) => {
  const seekable = typeof onSeek === 'function';
  const showPanel = editable && typeof onAssign === 'function';
  const editing = editable && typeof onSegmentsChange === 'function';

  // Unique raw speakers in order of first appearance — the rows of the panel
  // and the options of each per-turn dropdown.
  const rawSpeakers = useMemo(() => {
    const seen: string[] = [];
    for (const s of segments) {
      if (!seen.includes(s.speaker)) seen.push(s.speaker);
    }
    return seen;
  }, [segments]);

  const resolve = (raw: string) => speakerLabels?.[raw]?.name ?? raw;

  // One <div> ref per rendered turn, so a speaker chip click can scroll the
  // matching turn into view; one <textarea> ref per turn, for auto-grow and
  // for placing the caret after a split/merge renumbers the turns.
  const turnRefs = useRef<Array<HTMLDivElement | null>>([]);
  const textRefs = useRef<Array<HTMLTextAreaElement | null>>([]);
  // Per-speaker cursor into that speaker's turn list, and the turn currently
  // highlighted from a chip click.
  const [cycleIndex, setCycleIndex] = useState<Record<string, number>>({});
  const [highlighted, setHighlighted] = useState<number | null>(null);
  // After a split or merge the turns renumber; remember which turn to focus
  // (and where to put the caret) once the new segments have rendered.
  const [pendingFocus, setPendingFocus] = useState<{
    index: number;
    caret: number;
  } | null>(null);

  // Indices of every turn for each raw speaker, in transcript order.
  const turnsBySpeaker = useMemo(() => {
    const map: Record<string, number[]> = {};
    segments.forEach((s, i) => {
      if (!map[s.speaker]) map[s.speaker] = [];
      map[s.speaker].push(i);
    });
    return map;
  }, [segments]);

  // Segments can change under us (an edit splits/merges/renumbers turns); a
  // stale cursor or highlight would point at the wrong turn, so reset on change.
  useEffect(() => {
    setCycleIndex({});
    setHighlighted(null);
  }, [segments]);

  // Run after the edited segments have rendered: grow every textarea to fit
  // its text, and apply any caret focus queued by the last split/merge.
  useEffect(() => {
    textRefs.current.forEach((el) => {
      if (el) autoGrow(el);
    });
    if (pendingFocus) {
      const el = textRefs.current[pendingFocus.index];
      if (el) {
        el.focus();
        el.setSelectionRange(pendingFocus.caret, pendingFocus.caret);
      }
      setPendingFocus(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments]);

  // Step to a speaker's next turn, scroll it into view, and highlight it.
  // Wraps around after the last turn.
  const cycleToSpeaker = (raw: string) => {
    const turns = turnsBySpeaker[raw];
    if (!turns || turns.length === 0) return;
    const next = ((cycleIndex[raw] ?? -1) + 1) % turns.length;
    const segIndex = turns[next];
    setCycleIndex((prev) => ({ ...prev, [raw]: next }));
    setHighlighted(segIndex);
    turnRefs.current[segIndex]?.scrollIntoView({
      block: 'nearest',
      behavior: 'smooth',
    });
  };

  // ---- editing helpers (active only when `editing`) ----

  // Next unused "Speaker N" label — scans both the turns and any named
  // speakers so a fresh speaker can't collide with an existing one.
  const nextSpeakerLabel = () => {
    let max = 0;
    const scan = (label: string) => {
      const m = /^Speaker (\d+)$/.exec(label);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    };
    segments.forEach((s) => scan(s.speaker));
    Object.keys(speakerLabels ?? {}).forEach(scan);
    return `Speaker ${max + 1}`;
  };

  const editText = (i: number, text: string) => {
    onSegmentsChange?.(
      segments.map((s, idx) => (idx === i ? { ...s, text } : s)),
    );
  };

  const changeSpeaker = (i: number, value: string) => {
    const speaker = value === NEW_SPEAKER ? nextSpeakerLabel() : value;
    onSegmentsChange?.(
      segments.map((s, idx) => (idx === i ? { ...s, speaker } : s)),
    );
  };

  // Split turn `i` at caret offset `k`: text before the caret stays, text
  // after it becomes a new turn directly below with the same speaker. The
  // turn's time range is divided at the caret in proportion to the text, so
  // the new turn's timestamp still lands somewhere sensible in the audio. A
  // split that would leave either half blank is ignored.
  const splitTurn = (i: number, k: number) => {
    const seg = segments[i];
    const before = seg.text.slice(0, k);
    const after = seg.text.slice(k);
    if (!before.trim() || !after.trim()) return;
    const len = seg.text.length || 1;
    const mid = seg.start + (seg.end - seg.start) * (k / len);
    setPendingFocus({ index: i + 1, caret: 0 });
    onSegmentsChange?.([
      ...segments.slice(0, i),
      { ...seg, text: before, end: mid },
      { ...seg, text: after, start: mid },
      ...segments.slice(i + 1),
    ]);
  };

  // Merge turn `i` into the turn above it (Backspace at the line start): the
  // two texts join with a space, the time range spans both, and the caret
  // lands at the seam.
  const mergeUp = (i: number) => {
    if (i <= 0) return;
    const prev = segments[i - 1];
    const cur = segments[i];
    setPendingFocus({ index: i - 1, caret: prev.text.length });
    onSegmentsChange?.([
      ...segments.slice(0, i - 1),
      {
        ...prev,
        text: `${prev.text} ${cur.text}`,
        start: Math.min(prev.start, cur.start),
        end: Math.max(prev.end, cur.end),
      },
      ...segments.slice(i + 1),
    ]);
  };

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLTextAreaElement>,
    i: number,
  ) => {
    const el = e.currentTarget;
    if (e.key === 'Enter') {
      e.preventDefault();
      splitTurn(i, el.selectionStart);
    } else if (
      e.key === 'Backspace' &&
      el.selectionStart === 0 &&
      el.selectionEnd === 0
    ) {
      e.preventDefault();
      mergeUp(i);
    }
  };

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
                onCycle={() => cycleToSpeaker(raw)}
                turnCount={turnsBySpeaker[raw]?.length ?? 0}
                listId="diarized-transcript-participants"
              />
            ))}
          </div>
        </div>
      )}
      <div className="border-2 border-black bg-white p-3 max-h-96 overflow-y-auto">
        {editing && (
          <div className="flex items-baseline justify-between gap-2 mb-2">
            <p className="text-xs text-muted-foreground">
              Edit text directly. Press Enter to split a turn into a new line;
              Backspace at a line's start merges it into the turn above.
            </p>
            {saving && (
              <span className="text-xs text-muted-foreground shrink-0">
                Saving…
              </span>
            )}
          </div>
        )}
        {segments.map((s, i) => (
          <div
            key={i}
            ref={(el) => {
              turnRefs.current[i] = el;
            }}
            className={
              'mb-3 last:mb-0 transition-colors' +
              (highlighted === i
                ? ' bg-[#fff3a0] outline outline-2 outline-[#fd3777]'
                : '')
            }
          >
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
              {editing ? (
                <select
                  value={s.speaker}
                  onChange={(e) => changeSpeaker(i, e.target.value)}
                  title="Set this turn's speaker"
                  className="font-semibold text-[#fd3777] border-2 border-black bg-white px-1 py-0.5 text-sm"
                >
                  {rawSpeakers.map((raw) => (
                    <option key={raw} value={raw}>
                      {resolve(raw)}
                    </option>
                  ))}
                  <option value={NEW_SPEAKER}>+ New speaker</option>
                </select>
              ) : (
                <span className="font-semibold text-[#fd3777]">
                  {resolve(s.speaker)}
                </span>
              )}
            </div>
            {editing ? (
              <textarea
                ref={(el) => {
                  textRefs.current[i] = el;
                }}
                value={s.text}
                rows={1}
                onChange={(e) => {
                  autoGrow(e.currentTarget);
                  editText(i, e.currentTarget.value);
                }}
                onKeyDown={(e) => handleKeyDown(e, i)}
                className="text-sm w-full resize-none border-2 border-black px-2 py-1 leading-snug focus:outline-none focus:border-[#fd3777]"
              />
            ) : (
              <div className="text-sm pl-1 leading-snug">{s.text}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default DiarizedTranscript;
