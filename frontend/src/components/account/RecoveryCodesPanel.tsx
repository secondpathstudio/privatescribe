import NeoButton from "@/components/neo/neo-button";

type Props = {
  codes: string[];
  // Heading shown at the top of the panel. Defaults to a generic message.
  heading?: string;
  onAcknowledge?: () => void;
  acknowledgeLabel?: string;
};

export default function RecoveryCodesPanel({
  codes,
  heading = "Save these recovery codes",
  onAcknowledge,
  acknowledgeLabel = "I've saved them",
}: Props) {
  const text = codes.join("\n");

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard can be blocked in some Electron contexts. The codes are
      // still visible on-screen — the copy button is a convenience, not a
      // primary path. Silently swallow.
    }
  };

  const handleDownload = () => {
    const blob = new Blob([text + "\n"], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "privatescribe-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="border-[3px] border-black bg-[#ffff00] p-5 space-y-3 shadow-[4px_4px_0_0_#000]">
      <div>
        <p className="font-black uppercase tracking-wide text-sm">{heading}</p>
        <p className="text-sm mt-1">
          Each code can be used once to sign in if you lose access to your
          authenticator app. Store them somewhere safe — they won't be shown
          again.
        </p>
      </div>
      <ul className="grid grid-cols-2 gap-1 font-mono text-sm bg-white border-2 border-black p-3">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <NeoButton onClick={handleCopy} backgroundColor="#ffffff" textColor="#000000">
          Copy
        </NeoButton>
        <NeoButton onClick={handleDownload} backgroundColor="#ffffff" textColor="#000000">
          Download .txt
        </NeoButton>
        {onAcknowledge && (
          <NeoButton onClick={onAcknowledge} backgroundColor="#fd3777" textColor="#ffffff">
            {acknowledgeLabel}
          </NeoButton>
        )}
      </div>
    </div>
  );
}
