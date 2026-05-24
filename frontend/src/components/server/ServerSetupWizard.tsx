import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import NeoButton from "@/components/neo/neo-button";

/**
 * First-run "Use this Mac vs. Set up a server" chooser + the server-install
 * flow (roadmap Phase 9 item 4). Desktop-only — the caller should render this
 * instead of the plain setup form when `window.electron?.server` exists.
 *
 * Server path: configure the LAN port → `window.electron.server.install()`
 * (which prompts for admin and installs the launchd daemons) → show the
 * pairing URL. The caller then creates the super-admin against the running
 * server via `onServerReady`.
 *
 * NOTE (device-run wiring): after install, admin creation and the admin
 * dashboard must talk to the *daemon* backend behind Caddi (https://<mac>:port)
 * — i.e. API_BASE retargeting + self-signed-cert acceptance in Electron. That
 * runtime piece is built/tested on a Mac (Phase 9 item 5); `onServerReady`
 * receives the pairing URL so the caller can point there.
 */

const DEFAULT_LAN_PORT = 8443;

type Step = "choose" | "configure" | "installing" | "paired";

type Props = {
  /** User chose to run everything locally — render the standard setup form. */
  onStandalone: () => void;
  /** Server installed + running. `pairingUrl` is where clients (and this Mac's
   *  own admin UI) connect. The caller proceeds to super-admin creation. */
  onServerReady: (pairingUrl: string) => void;
};

export default function ServerSetupWizard({ onStandalone, onServerReady }: Props) {
  const [step, setStep] = useState<Step>("choose");
  const [lanPort, setLanPort] = useState(DEFAULT_LAN_PORT);
  const [pairingUrl, setPairingUrl] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const server = window.electron?.server;

  const install = async () => {
    if (!server) {
      setError("Server controls are unavailable in this build.");
      return;
    }
    setError(null);
    setStep("installing");
    try {
      const res = await server.install({ lanPort });
      if (!res.ok) {
        setError(res.error || "Installation failed.");
        setStep("configure");
        return;
      }
      const info = await server.info();
      setPairingUrl(info?.pairingUrl ?? `https://<this-mac-ip>:${lanPort}`);
      setStep("paired");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Installation failed.");
      setStep("configure");
    }
  };

  return (
    <div className="flex justify-center items-center">
      <Card className="w-[30rem]">
        {step === "choose" && (
          <>
            <CardHeader className="text-center">
              <CardTitle className="text-2xl font-black">SET UP PRIVATESCRIBE</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                How will this install be used?
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <button
                type="button"
                onClick={onStandalone}
                className="w-full border-2 border-black p-4 text-left hover:bg-yellow-50"
              >
                <p className="font-black">Use this Mac</p>
                <p className="text-sm text-muted-foreground">
                  Everything runs locally on this device. Best for a single user.
                </p>
              </button>
              <button
                type="button"
                onClick={() => setStep("configure")}
                className="w-full border-2 border-black p-4 text-left hover:bg-yellow-50"
              >
                <p className="font-black">Set up a server</p>
                <p className="text-sm text-muted-foreground">
                  This Mac hosts PrivateScribe for your team; staff connect from
                  their own devices over your network.
                </p>
              </button>
            </CardContent>
          </>
        )}

        {step === "configure" && (
          <>
            <CardHeader className="text-center">
              <CardTitle className="text-2xl font-black">SERVER NETWORK</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Choose the port staff will connect to. The default is fine for
                most networks.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label htmlFor="lanPort" className="font-black">HTTPS PORT</Label>
                <Input
                  id="lanPort"
                  type="number"
                  min={1}
                  max={65535}
                  value={lanPort}
                  onChange={(e) => setLanPort(Number(e.target.value) || DEFAULT_LAN_PORT)}
                />
              </div>
              <div className="border-2 border-black bg-yellow-100 p-3 text-sm">
                <p className="font-black">macOS will ask for your password.</p>
                <p className="mt-1">
                  Installing the background services needs administrator access.
                  The services keep running after you close this window or log out.
                </p>
              </div>
              {error && <p className="text-red-600 text-sm">{error}</p>}
              <div className="flex justify-between items-center pt-1">
                <NeoButton label="Back" backgroundColor="#e5e5e5" textColor="#000000"
                  onClick={() => { setError(null); setStep("choose"); }} />
                <NeoButton label="Install server" backgroundColor="#fd3777" textColor="#ffffff"
                  onClick={install} />
              </div>
            </CardContent>
          </>
        )}

        {step === "installing" && (
          <CardContent className="text-center py-10">
            <p className="font-black text-lg">Installing server services…</p>
            <p className="text-sm text-muted-foreground mt-2">
              Approve the macOS administrator prompt to continue.
            </p>
          </CardContent>
        )}

        {step === "paired" && (
          <>
            <CardHeader className="text-center">
              <CardTitle className="text-2xl font-black">SERVER RUNNING</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Staff connect their PrivateScribe app to this address:
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="border-2 border-black bg-white p-3 font-mono text-center break-all">
                {pairingUrl}
              </div>
              <div className="border-2 border-black bg-yellow-100 p-3 text-sm">
                <p className="font-black">Self-signed certificate.</p>
                <p className="mt-1">
                  On first connection each client confirms this server's security
                  fingerprint — that's expected on a private network.
                </p>
              </div>
              <div className="flex justify-center items-center pt-1">
                <NeoButton label="Create administrator account" backgroundColor="#fd3777"
                  textColor="#ffffff" onClick={() => onServerReady(pairingUrl)} />
              </div>
            </CardContent>
          </>
        )}
      </Card>
    </div>
  );
}
