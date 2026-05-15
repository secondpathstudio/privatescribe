/**
 * Renders a transcript with low-confidence Whisper words highlighted.
 *
 * Word probabilities come from Faster-Whisper attached to the ORIGINAL
 * transcript, but the displayed text may have been transformed by
 * dictation markers and/or abbreviation expansion before we received it.
 * To bridge the two, we walk the displayed tokens left-to-right and
 * advance a cursor through the `words` list, matching by lowercased
 * alphanumeric form. Tokens that don't match (substituted by an
 * abbreviation, inserted by a dictation marker) render unhighlighted —
 * they're not Whisper's output anyway.
 */

export type WordInfo = {
  word: string;
  probability: number;
  start: number;
  end: number;
};

type Props = {
  text: string;
  words: WordInfo[];
  // Words with probability below this threshold get highlighted. 0.6 is
  // a reasonable starting point — adjust if false positives feel noisy
  // or if real errors slip through.
  threshold?: number;
  className?: string;
};

const HIGHLIGHT_STYLE: React.CSSProperties = {
  backgroundColor: "#fff3a0",
  // Subtle underline so the highlight reads as "needs review" rather
  // than as text the user themselves marked up.
  textDecoration: "underline wavy #b78400",
  textUnderlineOffset: "2px",
};

// Strip punctuation and lowercase for word-matching. We compare the
// alphanumeric core of each token because Whisper tokens may carry
// trailing commas/periods that the displayed token doesn't (or vice
// versa once auto-punctuation moves things around).
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}'/-]/gu, "");
}

export default function ConfidenceText({
  text,
  words,
  threshold = 0.6,
  className,
}: Props) {
  if (!text) return null;

  // Split into alternating word / whitespace tokens so we can preserve
  // line breaks and spacing while still highlighting per word.
  const tokens = text.split(/(\s+)/);

  let cursor = 0;
  const nodes: React.ReactNode[] = [];

  tokens.forEach((tok, i) => {
    if (tok === "") return;
    if (/^\s+$/.test(tok)) {
      // Preserve whitespace verbatim — newlines included.
      nodes.push(<span key={i}>{tok}</span>);
      return;
    }

    const want = normalize(tok);
    let matched: WordInfo | null = null;
    // Forward scan from cursor. Cap the look-ahead at a small window so
    // a single missed token doesn't make us scan the rest of the list
    // for every subsequent token.
    const LOOKAHEAD = 6;
    for (let j = cursor; j < Math.min(words.length, cursor + LOOKAHEAD); j++) {
      if (normalize(words[j].word) === want) {
        matched = words[j];
        cursor = j + 1;
        break;
      }
    }

    const isLow = matched !== null && matched.probability < threshold;
    nodes.push(
      <span
        key={i}
        style={isLow ? HIGHLIGHT_STYLE : undefined}
        title={
          matched ? `confidence: ${(matched.probability * 100).toFixed(0)}%` : undefined
        }
      >
        {tok}
      </span>,
    );
  });

  return (
    <div
      className={className}
      style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
    >
      {nodes}
    </div>
  );
}

/** Count how many words in the list fall below the threshold. Useful for
 * showing an "N low-confidence words" hint to the user. */
export function countLowConfidence(words: WordInfo[], threshold = 0.6): number {
  return words.reduce((n, w) => (w.probability < threshold ? n + 1 : n), 0);
}
