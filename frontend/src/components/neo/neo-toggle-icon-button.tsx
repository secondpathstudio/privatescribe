import type { LucideIcon } from "lucide-react";

type Props = {
  icon: LucideIcon;
  label: string;
  on: boolean;
  onToggle: (next: boolean) => void;
  disabled?: boolean;
  // Tooltip / accessible name. Use this when the short label below the
  // button isn't enough context on its own.
  title?: string;
  // Pink (the app's primary accent) by default. Override for variety in
  // dense rows of toggles where same-color buttons would blur together.
  activeColor?: string;
};

export default function NeoToggleIconButton({
  icon: Icon,
  label,
  on,
  onToggle,
  disabled,
  title,
  activeColor = "#fd3777",
}: Props) {
  // Each whitespace-delimited word in the label is rendered on its own
  // line. These buttons are narrow (56px) so multi-word labels stack
  // vertically instead of overflowing.
  const labelLines = label.split(/\s+/).filter(Boolean);

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={title ?? label}
        title={title}
        disabled={disabled}
        onClick={() => onToggle(!on)}
        className={[
          "size-14 border-4 border-black flex items-center justify-center",
          "disabled:cursor-not-allowed disabled:opacity-50",
          on ? "text-white" : "bg-white text-black",
        ].join(" ")}
        style={{
          transition: "transform 0.1s, box-shadow 0.1s",
          backgroundColor: on ? activeColor : undefined,
          transform: on ? "translate(4px, 4px)" : "translate(0, 0)",
          boxShadow: on
            ? "4px 4px 0px 0px #000000"
            : "8px 8px 0px 0px #000000",
        }}
      >
        <Icon className="size-6" strokeWidth={2.5} />
      </button>
      <span className="flex flex-col items-center text-[10px] font-bold uppercase tracking-wider leading-tight text-black select-none">
        {labelLines.map((word) => (
          <span key={word}>{word}</span>
        ))}
      </span>
    </div>
  );
}
