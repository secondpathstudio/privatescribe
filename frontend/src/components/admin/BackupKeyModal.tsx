import { ReactNode, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import NeoButton from "@/components/neo/neo-button";

interface Props {
  backupKey: string;
  onAcknowledge: () => Promise<void> | void;
  // When true, this is the auto-shown one-shot first-admin modal — cannot be
  // dismissed without acknowledging. When false, it's the on-demand re-export
  // and we render a "Done" button instead.
  blocking?: boolean;
  onClose?: () => void;
  title?: string;
  description?: ReactNode;
}

export default function BackupKeyModal({
  backupKey,
  onAcknowledge,
  blocking = true,
  onClose,
  title,
  description,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [acking, setAcking] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(backupKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard API unavailable — user can still select & copy manually
    }
  };

  const handleAck = async () => {
    setAcking(true);
    try {
      await onAcknowledge();
    } finally {
      setAcking(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <Card
        className="w-full max-w-2xl bg-white text-black"
        style={{ boxShadow: "8px 8px 0px 0px #000000" }}
      >
        <CardHeader>
          <CardTitle className="text-2xl font-black text-black">
            {title ?? (blocking ? "Save your encryption key" : "Encryption key")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-black">
          {description !== undefined ? (
            <div className="text-sm">{description}</div>
          ) : (
            blocking && (
              <p className="text-sm">
                This is the only key that can decrypt your database. Save it somewhere durable
                (password manager, encrypted backup) <strong>now</strong> — once you click acknowledge,
                you'll need to re-enter your password from the admin page to see it again.
              </p>
            )
          )}
          <pre className="rounded border-2 border-black bg-gray-100 p-3 text-sm font-mono break-all whitespace-pre-wrap select-all text-black">
            {backupKey}
          </pre>
          <div className="flex flex-wrap items-center gap-3">
            <NeoButton
              onClick={handleCopy}
              backgroundColor="#ffffff"
              textColor="#000000"
            >
              {copied ? "Copied!" : "Copy"}
            </NeoButton>
            {blocking ? (
              <NeoButton
                onClick={handleAck}
                backgroundColor="#fd3777"
                textColor="#ffffff"
              >
                {acking ? "Acknowledging..." : "I have saved this"}
              </NeoButton>
            ) : (
              <NeoButton
                onClick={onClose}
                backgroundColor="#fd3777"
                textColor="#ffffff"
              >
                Done
              </NeoButton>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
