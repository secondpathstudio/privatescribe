import { API_BASE } from "@/lib/api";
import { useEffect, useState } from "react";
import { useAuth } from "@/context/auth-context";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import NeoButton from "@/components/neo/neo-button";
import RecoveryCodesPanel from "./RecoveryCodesPanel";

type Status = {
  enrolled: boolean;
  required: boolean;
  recovery_codes_remaining: number;
};

type EnrollPayload = {
  secret: string;
  provisioning_uri: string;
  qr_data_url: string;
};

type Mode = "idle" | "enrolling" | "disabling" | "regenerating";

export default function TwoFactorSection() {
  const auth = useAuth();
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [mode, setMode] = useState<Mode>("idle");
  const [enrollPayload, setEnrollPayload] = useState<EnrollPayload | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  const fetchStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/2fa/status`, {
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);
      setStatus({
        enrolled: !!data.enrolled,
        required: !!data.required,
        recovery_codes_remaining: data.recovery_codes_remaining ?? 0,
      });
      setError(null);
    } catch (e: any) {
      setError(e.message ?? "Could not load 2FA status");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.token]);

  const reset = () => {
    setMode("idle");
    setEnrollPayload(null);
    setCode("");
    setPassword("");
    setActionError(null);
    setRecoveryCodes(null);
  };

  const beginEnroll = async () => {
    setActionError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/2fa/enroll`, {
        method: "POST",
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);
      setEnrollPayload({
        secret: data.secret,
        provisioning_uri: data.provisioning_uri,
        qr_data_url: data.qr_data_url,
      });
      setMode("enrolling");
    } catch (e: any) {
      setActionError(e.message ?? "Could not start enrollment");
    } finally {
      setSubmitting(false);
    }
  };

  const submitEnrollment = async () => {
    setActionError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/2fa/verify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);
      setRecoveryCodes(data.recovery_codes);
      setEnrollPayload(null);
      setCode("");
      await fetchStatus();
    } catch (e: any) {
      setActionError(e.message ?? "Could not verify");
    } finally {
      setSubmitting(false);
    }
  };

  const submitDisable = async () => {
    setActionError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/2fa/disable`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);
      reset();
      await fetchStatus();
    } catch (e: any) {
      setActionError(e.message ?? "Could not disable");
    } finally {
      setSubmitting(false);
    }
  };

  const submitRegenerate = async () => {
    setActionError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/2fa/recovery-codes/regenerate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);
      setRecoveryCodes(data.recovery_codes);
      setPassword("");
      setMode("idle");
      await fetchStatus();
    } catch (e: any) {
      setActionError(e.message ?? "Could not regenerate");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <section className="border-2 border-black bg-white p-6">
        <p className="text-sm text-muted-foreground">Loading two-factor status...</p>
      </section>
    );
  }
  if (!status) {
    return (
      <section className="border-2 border-black bg-white p-6">
        <p className="text-red-600 text-sm">{error ?? "Could not load two-factor status"}</p>
      </section>
    );
  }

  return (
    <section className="border-2 border-black bg-white p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-black">Two-factor authentication</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Add a 6-digit code from an authenticator app (Google Authenticator,
            Authy, 1Password, etc.) on top of your password.
          </p>
        </div>
        <span
          className={[
            "shrink-0 px-2 py-1 text-[11px] font-bold uppercase tracking-wider border-2 border-black",
            status.enrolled ? "bg-[#ffff00]" : "bg-white",
          ].join(" ")}
        >
          {status.enrolled ? "Enrolled" : "Not enrolled"}
        </span>
      </div>

      {!status.enrolled && status.required && (
        <div className="border-[2px] border-black bg-[#ffff00] p-3 text-sm">
          Your administrator requires two-factor authentication. You'll be
          prompted to enroll on your next sign-in if you don't do it here first.
        </div>
      )}
      {status.enrolled && status.required && (
        <div className="border-[2px] border-black bg-gray-50 p-3 text-xs">
          Required by your administrator — you can regenerate recovery codes,
          but not disable the second factor.
        </div>
      )}

      {recoveryCodes && (
        <RecoveryCodesPanel
          codes={recoveryCodes}
          heading={
            mode === "regenerating" || (status.enrolled && !enrollPayload)
              ? "New recovery codes — old ones are no longer valid"
              : "Save these recovery codes"
          }
          onAcknowledge={() => setRecoveryCodes(null)}
        />
      )}

      {!status.enrolled && mode === "idle" && !recoveryCodes && (
        <div>
          {actionError && <p className="text-red-600 text-sm mb-3">{actionError}</p>}
          <NeoButton
            onClick={beginEnroll}
            backgroundColor="#fd3777"
            textColor="#ffffff"
            disabled={submitting}
          >
            {submitting ? "Starting..." : "Enable two-factor"}
          </NeoButton>
        </div>
      )}

      {mode === "enrolling" && enrollPayload && (
        <div className="space-y-4 border-2 border-black p-4 bg-gray-50">
          <div>
            <p className="font-bold text-sm">1. Scan this QR code with your authenticator app</p>
            <img
              src={enrollPayload.qr_data_url}
              alt="Two-factor enrollment QR code"
              className="mt-2 size-48 border-2 border-black bg-white"
            />
            <details className="mt-2">
              <summary className="text-xs underline cursor-pointer">
                Can't scan? Use this code manually.
              </summary>
              <p className="text-xs font-mono mt-1 break-all">{enrollPayload.secret}</p>
            </details>
          </div>
          <div>
            <Label htmlFor="enroll-code" className="font-black">
              2. Enter the 6-digit code your app shows
            </Label>
            <Input
              id="enroll-code"
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              autoComplete="one-time-code"
              autoFocus
              required
              className="font-mono tracking-widest text-lg"
            />
          </div>
          {actionError && <p className="text-red-600 text-sm">{actionError}</p>}
          <div className="flex gap-2">
            <NeoButton
              onClick={submitEnrollment}
              backgroundColor="#fd3777"
              textColor="#ffffff"
              disabled={submitting || code.length !== 6}
            >
              {submitting ? "Verifying..." : "Verify and enable"}
            </NeoButton>
            <NeoButton
              onClick={reset}
              backgroundColor="#ffffff"
              textColor="#000000"
              disabled={submitting}
            >
              Cancel
            </NeoButton>
          </div>
        </div>
      )}

      {status.enrolled && mode === "idle" && !recoveryCodes && (
        <div className="space-y-3">
          <p className="text-sm">
            Recovery codes remaining: <strong>{status.recovery_codes_remaining}</strong> of 10.
            {status.recovery_codes_remaining <= 3 && (
              <span className="ml-1 text-red-600">Consider regenerating.</span>
            )}
          </p>
          {actionError && <p className="text-red-600 text-sm">{actionError}</p>}
          <div className="flex flex-wrap gap-2">
            <NeoButton
              onClick={() => setMode("regenerating")}
              backgroundColor="#ffffff"
              textColor="#000000"
            >
              Regenerate recovery codes
            </NeoButton>
            <NeoButton
              onClick={() => setMode("disabling")}
              backgroundColor="#ffffff"
              textColor="#000000"
              disabled={status.required}
              title={
                status.required
                  ? "Your administrator requires two-factor — you can't disable it from here."
                  : undefined
              }
            >
              Disable two-factor
            </NeoButton>
          </div>
        </div>
      )}

      {(mode === "disabling" || mode === "regenerating") && (
        <div className="space-y-3 border-2 border-black p-4 bg-gray-50">
          <p className="font-bold text-sm">
            {mode === "disabling" ? "Confirm disable" : "Confirm regenerate"}
          </p>
          <p className="text-xs text-muted-foreground">
            {mode === "disabling"
              ? "Enter your password to remove the second factor from this account."
              : "Enter your password. Your existing recovery codes will be invalidated and replaced."}
          </p>
          <div>
            <Label htmlFor="confirm-password" className="font-black">
              Password
            </Label>
            <Input
              id="confirm-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              autoFocus
              required
            />
          </div>
          {actionError && <p className="text-red-600 text-sm">{actionError}</p>}
          <div className="flex gap-2">
            <NeoButton
              onClick={mode === "disabling" ? submitDisable : submitRegenerate}
              backgroundColor="#fd3777"
              textColor="#ffffff"
              disabled={submitting || !password}
            >
              {submitting
                ? "Working..."
                : mode === "disabling"
                ? "Disable two-factor"
                : "Regenerate codes"}
            </NeoButton>
            <NeoButton
              onClick={reset}
              backgroundColor="#ffffff"
              textColor="#000000"
              disabled={submitting}
            >
              Cancel
            </NeoButton>
          </div>
        </div>
      )}
    </section>
  );
}
