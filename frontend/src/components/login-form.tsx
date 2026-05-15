import { API_BASE } from "@/lib/api";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/auth-context";
import NeoButton from "./neo/neo-button";
import RecoveryCodesPanel from "./account/RecoveryCodesPanel";

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

type Step =
  | { kind: "password" }
  | { kind: "twofa_challenge"; challenge_token: string; email: string }
  | {
      kind: "twofa_enroll";
      enrollment_token: string;
      email: string;
      secret: string;
      qr_data_url: string;
    }
  | { kind: "twofa_enroll_done"; recovery_codes: string[] };

export default function LoginForm() {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(loginSchema),
  });

  const auth = useAuth();
  const [step, setStep] = useState<Step>({ kind: "password" });
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const completeLogin = (data: any) => {
    auth.login(data.access_token, data.refresh_token, data.user);
    // RequireAuth/Login redirects on next render once auth.token is set.
  };

  const onPasswordSubmit = async (formData: any) => {
    setServerError(null);
    setSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: formData.email, password: formData.password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setServerError(data.error || `Server error ${response.status}`);
        return;
      }
      if (data.requires_2fa) {
        setStep({ kind: "twofa_challenge", challenge_token: data.challenge_token, email: formData.email });
        return;
      }
      if (data.requires_2fa_enrollment) {
        // Hand the enrollment_token straight into /api/login/2fa-enroll so the
        // user sees the QR right away rather than a "you must enroll" interstitial.
        const enrollRes = await fetch(`${API_BASE}/api/login/2fa-enroll`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enrollment_token: data.enrollment_token }),
        });
        const enrollData = await enrollRes.json().catch(() => ({}));
        if (!enrollRes.ok) {
          setServerError(enrollData.error || `Server error ${enrollRes.status}`);
          return;
        }
        setStep({
          kind: "twofa_enroll",
          enrollment_token: enrollData.enrollment_token,
          email: formData.email,
          secret: enrollData.secret,
          qr_data_url: enrollData.qr_data_url,
        });
        return;
      }
      completeLogin(data);
    } catch (e: any) {
      setServerError(e?.message ?? "Network error");
    } finally {
      setSubmitting(false);
    }
  };

  if (step.kind === "twofa_challenge") {
    return (
      <TwoFactorChallenge
        email={step.email}
        challengeToken={step.challenge_token}
        onSuccess={completeLogin}
        onCancel={() => {
          setStep({ kind: "password" });
          setServerError(null);
        }}
      />
    );
  }
  if (step.kind === "twofa_enroll") {
    return (
      <TwoFactorEnroll
        email={step.email}
        enrollmentToken={step.enrollment_token}
        secret={step.secret}
        qrDataUrl={step.qr_data_url}
        onSuccess={(data) => {
          // Stash the access tokens but stop short of triggering navigation
          // until the user has acknowledged their recovery codes — once
          // auth.token flips truthy the Login page redirects to /notes.
          setStep({ kind: "twofa_enroll_done", recovery_codes: data.recovery_codes });
          // Defer the auth.login call until the user clicks "I've saved them".
          // Holding it in a closure on the panel below.
          (window as any).__pendingLoginData = data;
        }}
        onCancel={() => {
          setStep({ kind: "password" });
          setServerError(null);
        }}
      />
    );
  }
  if (step.kind === "twofa_enroll_done") {
    return (
      <div className="flex justify-center items-center">
        <div className="w-[28rem] max-w-full space-y-4">
          <RecoveryCodesPanel
            codes={step.recovery_codes}
            heading="Save these recovery codes before continuing"
            onAcknowledge={() => {
              const pending = (window as any).__pendingLoginData;
              delete (window as any).__pendingLoginData;
              if (pending) completeLogin(pending);
            }}
            acknowledgeLabel="I've saved them — continue to my account"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-center items-center">
      <Card className="w-96">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-black">LOGIN</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onPasswordSubmit)} className="space-y-4">
            <div>
              <Label htmlFor="email" className="font-black">EMAIL</Label>
              <Input id="email" type="email" autoComplete="email" {...register("email")} />
              {errors.email && <p className="text-red-500 text-sm">{errors.email.message}</p>}
            </div>
            <div>
              <Label htmlFor="password" className="font-black">PASSWORD</Label>
              <Input id="password" type="password" autoComplete="current-password" {...register("password")} />
              {errors.password && <p className="text-red-500 text-sm">{errors.password.message}</p>}
            </div>
            {serverError && <p className="text-red-600 text-sm">{serverError}</p>}
            <div className="flex justify-center items-center">
              <NeoButton
                label={submitting ? "Signing in..." : "Login"}
                backgroundColor="#fd3777"
                textColor="#ffffff"
                type="submit"
                disabled={submitting}
              />
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function TwoFactorChallenge({
  email,
  challengeToken,
  onSuccess,
  onCancel,
}: {
  email: string;
  challengeToken: string;
  onSuccess: (data: any) => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState("");
  const [usingRecovery, setUsingRecovery] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/login/2fa`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challenge_token: challengeToken, code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `Server error ${res.status}`);
        return;
      }
      onSuccess(data);
    } catch (e: any) {
      setError(e?.message ?? "Network error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex justify-center items-center">
      <Card className="w-96">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-black">VERIFY</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Enter the {usingRecovery ? "recovery code" : "6-digit code from your authenticator app"} for{" "}
            <strong>{email}</strong>.
          </p>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label htmlFor="otp" className="font-black">
                {usingRecovery ? "Recovery code" : "Code"}
              </Label>
              <Input
                id="otp"
                type="text"
                inputMode={usingRecovery ? "text" : "numeric"}
                maxLength={usingRecovery ? 16 : 6}
                value={code}
                onChange={(e) =>
                  setCode(usingRecovery ? e.target.value : e.target.value.replace(/\D/g, ""))
                }
                autoComplete="one-time-code"
                autoFocus
                required
                className="font-mono tracking-widest text-lg"
              />
            </div>
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <div className="flex flex-col gap-2">
              <NeoButton
                type="submit"
                backgroundColor="#fd3777"
                textColor="#ffffff"
                disabled={submitting || code.length === 0}
              >
                {submitting ? "Verifying..." : "Verify"}
              </NeoButton>
              <button
                type="button"
                className="text-xs underline text-muted-foreground"
                onClick={() => {
                  setUsingRecovery((v) => !v);
                  setCode("");
                  setError(null);
                }}
              >
                {usingRecovery ? "Use authenticator code instead" : "Use a recovery code instead"}
              </button>
              <button
                type="button"
                className="text-xs underline text-muted-foreground"
                onClick={onCancel}
              >
                Cancel and start over
              </button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function TwoFactorEnroll({
  email,
  enrollmentToken,
  secret,
  qrDataUrl,
  onSuccess,
  onCancel,
}: {
  email: string;
  enrollmentToken: string;
  secret: string;
  qrDataUrl: string;
  onSuccess: (data: any) => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/login/2fa-enroll-verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enrollment_token: enrollmentToken, code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `Server error ${res.status}`);
        return;
      }
      onSuccess(data);
    } catch (e: any) {
      setError(e?.message ?? "Network error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex justify-center items-center">
      <Card className="w-[28rem] max-w-full">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-black">SET UP TWO-FACTOR</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm mb-4">
            Your administrator requires two-factor authentication. Set it up for{" "}
            <strong>{email}</strong> to finish signing in.
          </p>

          <div className="space-y-4">
            <div>
              <p className="font-bold text-sm">1. Scan this QR with an authenticator app</p>
              <img
                src={qrDataUrl}
                alt="Two-factor enrollment QR code"
                className="mt-2 size-48 border-2 border-black bg-white"
              />
              <details className="mt-2">
                <summary className="text-xs underline cursor-pointer">
                  Can't scan? Use this code manually.
                </summary>
                <p className="text-xs font-mono mt-1 break-all">{secret}</p>
              </details>
            </div>

            <form onSubmit={submit} className="space-y-3">
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
              {error && <p className="text-red-600 text-sm">{error}</p>}
              <div className="flex flex-col gap-2">
                <NeoButton
                  type="submit"
                  backgroundColor="#fd3777"
                  textColor="#ffffff"
                  disabled={submitting || code.length !== 6}
                >
                  {submitting ? "Verifying..." : "Verify and finish login"}
                </NeoButton>
                <button
                  type="button"
                  className="text-xs underline text-muted-foreground"
                  onClick={onCancel}
                >
                  Cancel and start over
                </button>
              </div>
            </form>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
