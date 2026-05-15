/**
 * Contenteditable transcript editor with inline confidence highlighting.
 *
 * Renders the text as a div containing inline spans for low-confidence
 * Whisper words. The user edits directly in this div — highlights stay
 * in place until they change a flagged word, at which point the span's
 * text content no longer matches its original probability data (which is
 * fine, that's the signal that the word has been reviewed).
 *
 * We DON'T re-render highlights on every keystroke. That would reset the
 * caret position and feel awful. Highlight DOM is rebuilt only when the
 * `value` prop arrives from outside (initial mount, form.reset(),
 * external update).
 */
import { useEffect, useRef } from "react";
import type { WordInfo } from "./ConfidenceText";

type Props = {
  value: string;
  words: WordInfo[];
  threshold?: number;
  onChange: (next: string) => void;
  disabled?: boolean;
  className?: string;
};

function escapeHTML(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}'/-]/gu, "");
}

// Inline-style strings for the two flagged-word states. Keeping them as
// constants so the input handler (which re-applies them as the user edits)
// uses the exact same values as the initial render.
const STYLE_LOW =
  "background-color:#fff3a0;text-decoration:underline wavy #b78400;text-underline-offset:2px";
const STYLE_EDITED =
  // Light mint background, no underline — signals "you've changed this
  // since transcription" without being as loud as the yellow.
  "background-color:#d1fae5;text-decoration:none";

function renderHTML(text: string, words: WordInfo[], threshold: number): string {
  if (!text) return "";
  const tokens = text.split(/(\s+)/);
  let cursor = 0;
  const parts: string[] = [];
  const LOOKAHEAD = 6;
  for (const tok of tokens) {
    if (tok === "") continue;
    if (/^\s+$/.test(tok)) {
      parts.push(escapeHTML(tok));
      continue;
    }
    const want = normalize(tok);
    let matched: WordInfo | null = null;
    for (let j = cursor; j < Math.min(words.length, cursor + LOOKAHEAD); j++) {
      if (normalize(words[j].word) === want) {
        matched = words[j];
        cursor = j + 1;
        break;
      }
    }
    if (matched && matched.probability < threshold) {
      const pct = (matched.probability * 100).toFixed(0);
      // data-conf-original carries the exact rendered text of the original
      // token. On every input event we compare each span's textContent to
      // this and swap the inline style: yellow when unchanged, green when
      // the user has touched it.
      parts.push(
        `<span data-conf-original="${escapeHTML(tok)}" data-conf-prob="${pct}" style="${STYLE_LOW}" title="confidence: ${pct}%">${escapeHTML(tok)}</span>`,
      );
    } else {
      parts.push(escapeHTML(tok));
    }
  }
  return parts.join("");
}

/** Re-style each flagged-word span based on whether its content still
 * matches the original. Called after every keystroke. Cheap — just walks
 * the spans we already added. */
function syncSpanStyles(root: HTMLElement) {
  const spans = root.querySelectorAll<HTMLElement>("[data-conf-original]");
  spans.forEach((span) => {
    const original = span.getAttribute("data-conf-original") || "";
    const current = span.textContent || "";
    if (current === original) {
      span.setAttribute("style", STYLE_LOW);
      span.setAttribute("title", `confidence: ${span.getAttribute("data-conf-prob")}%`);
    } else {
      span.setAttribute("style", STYLE_EDITED);
      span.setAttribute("title", `edited from: ${original}`);
    }
  });
}

export default function EditableConfidenceText({
  value,
  words,
  threshold = 0.6,
  onChange,
  disabled,
  className,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  // Tracks the last text we know matches the DOM. If `value` arrives from
  // outside and differs from this, we rebuild the highlight DOM. If they
  // match, we skip — the change came from a keystroke and the DOM is
  // already correct.
  const internalValue = useRef<string>(value);

  // Initial render + react to external value changes.
  useEffect(() => {
    if (!ref.current) return;
    if (value === internalValue.current && ref.current.innerHTML !== "") return;
    ref.current.innerHTML = renderHTML(value || "", words, threshold);
    internalValue.current = value || "";
  }, [value, words, threshold]);

  const handleInput = () => {
    if (!ref.current) return;
    // innerText gives us \n at line breaks, which is what callers expect
    // for a plain-text transcript field. textContent collapses them in
    // some browsers and won't preserve user-typed Enter keys.
    const next = ref.current.innerText;
    internalValue.current = next;
    // Re-evaluate per-span styling before notifying the parent. Walking
    // every flagged span on each keystroke is cheap (typical transcripts
    // have a few dozen at most) and keeps the green/yellow indication
    // honest without rebuilding the DOM.
    syncSpanStyles(ref.current);
    onChange(next);
  };

  // Normalize Enter so we always insert a plain "\n" instead of letting
  // the browser inject <div>, <p>, or <br> elements that confuse the
  // highlight rebuild on the next external value update.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      document.execCommand("insertLineBreak");
    }
  };

  return (
    <div
      ref={ref}
      contentEditable={!disabled}
      suppressContentEditableWarning
      onInput={handleInput}
      onKeyDown={handleKeyDown}
      spellCheck={!disabled}
      role="textbox"
      aria-multiline="true"
      aria-disabled={disabled}
      className={[
        "border-2 border-black bg-white p-3 text-sm",
        "focus:outline-none focus:ring-2 focus:ring-[#fd3777]",
        disabled ? "text-gray-500 cursor-not-allowed" : "",
        className || "",
      ].join(" ")}
      style={{
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        minHeight: "6em",
      }}
    />
  );
}
