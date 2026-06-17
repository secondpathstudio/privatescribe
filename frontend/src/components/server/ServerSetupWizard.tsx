import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import NeoButton from "@/components/neo/neo-button";

/**
 * First-run "Use this computer vs. Set up a server" chooser + the server-install
 * flow (roadmap Phase 9 item 4). Desktop-only — the caller should render this
 * instead of the plain setup form when `window.electron?.server` exists.
 *
 * Server path: configure the LAN port → `window.electron.server.install()`
 * (which prompts for admin and installs the OS background services) → show the
 * pairing URL. The caller then creates the super-admin against the running
 * server via `onServerReady`.
 *
 * NOTE (device-run wiring): after install, admin creation and the admin
 * dashboard must talk to the backend service behind Caddy (https://<host>:port)
 * — i.e. API_BASE retargeting + self-signed-cert acceptance in Electron. That
 * runtime piece is platform-neutral (Phase 9 item 5); `onServerReady` receives
 * the pairing URL so the caller can point there.
 */

const DEFAULT_LAN_PORT = 8443;

const fmtGb = (bytes?: number): string => `${((bytes ?? 0) / 1024 ** 3).toFixed(1)} GB`;

type Step = "choose" | "configure" | "installing" | "paired" | "connect";

type Props = {
  /** User chose to run everything locally — render the standard setup form. */
  onStandalone: () => void;
  /** Server installed + running. `pairingUrl` is where clients (and this computer's
   *  own admin UI) connect. The caller proceeds to super-admin creation. */
  onServerReady: (pairingUrl: string) => void;
};

export default function ServerSetupWizard({ onStandalone, onServerReady }: Props) {
  const [step, setStep] = useState<Step>("choose");
  const [lanPort, setLanPort] = useState(DEFAULT_LAN_PORT);
  const [pairingUrl, setPairingUrl] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  // One-time engine-download progress during install (server:install-progress).
  const [installProgress, setInstallProgress] = useState<{
    phase: "download" | "verify" | "extract";
    received?: number;
    total?: number;
  } | null>(null);

  // Client-pairing state ("Connect to a server").
  const [serverUrl, setServerUrl] = useState("");
  const [probing, setProbing] = useState(false);
  const [probed, setProbed] = useState<{ origin: string; fingerprint?: string } | null>(null);
  const [discovered, setDiscovered] = useState<{ name: string; origin: string; host: string }[]>([]);
  const [discovering, setDiscovering] = useState(false);

  const server = window.electron?.server;
  const client = window.electron?.client;

  // Browse the LAN for servers when the connect step opens, so the common case
  // is "click the server you see" rather than typing an address.
  useEffect(() => {
    if (step !== "connect" || !client) return;
    let cancelled = false;
    setDiscovering(true);
    setDiscovered([]);
    client
      .discover()
      .then((list) => { if (!cancelled) setDiscovered(list); })
      .catch(() => { /* discovery is best-effort; manual entry remains */ })
      .finally(() => { if (!cancelled) setDiscovering(false); });
    return () => { cancelled = true; };
  }, [step, client]);

  // Validate a server (an explicit URL from a discovered entry, or the typed
  // one) and, on success, surface the confirm panel before committing.
  const probe = async (url?: string) => {
    if (!client) return;
    const target = url ?? serverUrl;
    setError(null);
    setProbed(null);
    setProbing(true);
    try {
      const res = await client.probe(target);
      if (res.ok && res.origin) {
        setServerUrl(res.origin);
        setProbed({ origin: res.origin, fingerprint: res.fingerprint });
      } else {
        setError(res.error || "Couldn't connect to that server.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't connect to that server.");
    } finally {
      setProbing(false);
    }
  };

  const install = async () => {
    if (!server) {
      setError("Server controls are unavailable in this build.");
      return;
    }
    setError(null);
    setInstallProgress(null);
    setStep("installing");
    // Stream the one-time engine download into a progress bar. No events fire
    // once the runtime is already staged, so a re-install goes straight through.
    const unsubscribe = server.onInstallProgress?.((p) => setInstallProgress(p));
    try {
      const res = await server.install({ lanPort });
      if (!res.ok) {
        setError(res.error || "Installation failed.");
        setStep("configure");
        return;
      }
      const info = await server.info();
      setPairingUrl(info?.pairingUrl ?? `https://<this-server-ip>:${lanPort}`);
      setStep("paired");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Installation failed.");
      setStep("configure");
    } finally {
      unsubscribe?.();
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
            <CardContent className="space-y-5">
              <div>
                <NeoButton
                  label="Use this computer"
                  backgroundColor="#fd3777"
                  textColor="#ffffff"
                  className="w-full"
                  onClick={onStandalone}
                />
                <p className="text-sm text-muted-foreground mt-2">
                  Everything runs locally on this device. Best for a single user.
                </p>
              </div>
              <div>
                <NeoButton
                  label="Set up a server"
                  backgroundColor="#fd3777"
                  textColor="#ffffff"
                  className="w-full"
                  onClick={() => setStep("configure")}
                />
                <p className="text-sm text-muted-foreground mt-2">
                  This computer hosts PrivateScribe for your team; staff connect from
                  their own devices over your network.
                </p>
              </div>
              {client && (
                <div>
                  <NeoButton
                    label="Connect to a server"
                    backgroundColor="#fd3777"
                    textColor="#ffffff"
                    className="w-full"
                    onClick={() => { setError(null); setStep("connect"); }}
                  />
                  <p className="text-sm text-muted-foreground mt-2">
                    Your team already runs a PrivateScribe server. Connect this
                    computer to it; all transcription happens on the server.
                  </p>
                </div>
              )}
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
                <p className="font-black">Your system will ask for administrator permission.</p>
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
            {installProgress?.phase === "download" && installProgress.total ? (
              <>
                <p className="font-black text-lg">Downloading the AI engine…</p>
                <div className="mt-3">
                  <div className="h-4 border-2 border-black bg-white">
                    <div
                      className="h-full bg-black transition-all"
                      style={{
                        width: `${Math.min(
                          100,
                          Math.round(
                            ((installProgress.received ?? 0) / installProgress.total) * 100,
                          ),
                        )}%`,
                      }}
                    />
                  </div>
                  <p className="mt-1 font-mono text-xs">
                    {fmtGb(installProgress.received)} / {fmtGb(installProgress.total)} —
                    one-time, ~1.2 GB
                  </p>
                </div>
              </>
            ) : (
              <p className="font-black text-lg">
                {installProgress ? "Preparing the engine…" : "Installing server services…"}
              </p>
            )}
            <p className="text-sm text-muted-foreground mt-2">
              Approve the administrator prompt when it appears.
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
                  textColor="#ffffff"
                  onClick={async () => {
                    onServerReady(pairingUrl);
                    // Relaunch into server mode so the admin account is created
                    // on the daemon (behind Caddy), not the local backend.
                    await server?.finishSetup();
                  }} />
              </div>
            </CardContent>
          </>
        )}

        {step === "connect" && (
          <>
            <CardHeader className="text-center">
              <CardTitle className="text-2xl font-black">CONNECT TO A SERVER</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Enter the address your administrator gave you (it's shown on the
                server's dashboard, e.g. <span className="font-mono">https://10.0.1.75:8443</span>).
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Auto-discovered servers — the one-click path. */}
              {(discovering || discovered.length > 0) && !probed && (
                <div>
                  <Label className="font-black">
                    {discovering ? "SEARCHING YOUR NETWORK…" : "SERVERS ON YOUR NETWORK"}
                  </Label>
                  <div className="space-y-2 mt-1">
                    {discovered.map((s) => (
                      <button
                        key={s.origin}
                        disabled={probing}
                        onClick={() => probe(s.origin)}
                        className="w-full border-2 border-black bg-white p-3 text-left hover:bg-yellow-100 disabled:opacity-50"
                      >
                        <div className="font-black">{s.name}</div>
                        <div className="font-mono text-xs text-muted-foreground break-all">{s.origin}</div>
                      </button>
                    ))}
                    {discovering && discovered.length === 0 && (
                      <p className="text-sm text-muted-foreground">Looking for PrivateScribe servers…</p>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">Or enter the address manually:</p>
                </div>
              )}

              <div>
                <Label htmlFor="serverUrl" className="font-black">SERVER ADDRESS</Label>
                <Input
                  id="serverUrl"
                  type="text"
                  inputMode="url"
                  autoCapitalize="none"
                  autoCorrect="off"
                  placeholder="https://10.0.1.75:8443"
                  value={serverUrl}
                  onChange={(e) => { setServerUrl(e.target.value); setProbed(null); setError(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter" && !probing && !probed) probe(); }}
                />
              </div>

              {error && <p className="text-red-600 text-sm">{error}</p>}

              {probed && (
                <div className="border-2 border-black bg-green-100 p-3 text-sm">
                  <p className="font-black">Found a PrivateScribe server ✓</p>
                  <p className="mt-1 font-mono break-all">{probed.origin}</p>
                  {probed.fingerprint && (
                    <p className="mt-2 text-xs text-muted-foreground break-all">
                      Security fingerprint: {probed.fingerprint}
                    </p>
                  )}
                  <p className="mt-2">
                    This computer will connect to it and won't store any data locally —
                    transcription and notes live on the server.
                  </p>
                </div>
              )}

              <div className="flex justify-between items-center pt-1">
                <NeoButton label="Back" backgroundColor="#e5e5e5" textColor="#000000"
                  onClick={() => { setError(null); setProbed(null); setStep("choose"); }} />
                {probed ? (
                  <NeoButton label="Connect &amp; restart" backgroundColor="#fd3777" textColor="#ffffff"
                    onClick={() => client?.connect(probed.origin)} />
                ) : (
                  <NeoButton
                    label={probing ? "Checking…" : "Connect"}
                    backgroundColor="#fd3777"
                    textColor="#ffffff"
                    onClick={() => { if (!probing) probe(); }}
                  />
                )}
              </div>
            </CardContent>
          </>
        )}
      </Card>
    </div>
  );
}
