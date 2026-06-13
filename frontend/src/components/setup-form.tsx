import { API_BASE } from "@/lib/api";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/auth-context";
import NeoButton from "./neo/neo-button";

// Organization is required in standalone (single-org install) but omitted in
// server mode, where the first-run admin is an org-less super-admin (central
// IT) who creates departments afterward.
const buildSetupSchema = (serverMode: boolean) =>
  z
    .object({
      organization: serverMode ? z.string().optional() : z.string().min(1, "Required"),
      firstName: z.string().min(1, "Required"),
      lastName: z.string().min(1, "Required"),
      email: z.string().email("Invalid email address"),
      password: z.string().min(8, "Password must be at least 8 characters"),
      passwordConfirm: z.string(),
      noLogin: z.boolean().optional(),
    })
    .refine((d) => d.password === d.passwordConfirm, {
      message: "Passwords do not match",
      path: ["passwordConfirm"],
    });

type SetupFormProps = {
  onDone?: () => void;
  /** Server-mode bootstrap: hide the organization field and create an org-less
   *  super-admin instead of a single-org admin. */
  serverMode?: boolean;
};

export default function SetupForm({ onDone, serverMode = false }: SetupFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({ resolver: zodResolver(buildSetupSchema(serverMode)) });
  const auth = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (formData: any) => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/setup/create-admin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: formData.email,
          password: formData.password,
          firstName: formData.firstName,
          lastName: formData.lastName,
          // Omitted in server mode — the super-admin is org-less.
          ...(serverMode ? {} : { organization: formData.organization }),
          // Standalone only: skip the login screen on this device from now on.
          ...(serverMode ? {} : { noLogin: !!formData.noLogin }),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err.error || `Setup failed: ${res.status}`);
        return;
      }
      // Auto-login with the credentials we just created so the user lands
      // on /notes instead of having to retype.
      const loginRes = await fetch(`${API_BASE}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: formData.email, password: formData.password }),
      });
      const data = await loginRes.json();
      if (loginRes.ok) {
        auth.login(data.access_token, data.refresh_token, data.user);
        onDone?.();
      } else {
        setError(data.error || "Auto-login failed; please sign in manually.");
      }
    } catch (e: any) {
      setError(e?.message ?? "Network error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex justify-center items-center">
      <Card className="w-[28rem]">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-black">
            {serverMode ? "CREATE ADMINISTRATOR ACCOUNT" : "SET UP YOUR APP"}
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            {serverMode
              ? "This is the server's administrator (central IT). They manage departments and staff; you'll add those after sign-in. Your encryption key is generated automatically — back it up after sign-in."
              : "Welcome — create your organization and admin account to get started. Your encryption key will be generated automatically; back it up after sign-in."}
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
            {!serverMode && (
              <div>
                <Label htmlFor="organization" className="font-black">ORGANIZATION</Label>
                <Input id="organization" maxLength={255} autoComplete="organization" {...register("organization")} />
                {errors.organization && (
                  <p className="text-red-500 text-sm">{errors.organization.message as string}</p>
                )}
              </div>
            )}
            <div>
              <Label htmlFor="firstName" className="font-black">FIRST NAME</Label>
              <Input id="firstName" {...register("firstName")} />
              {errors.firstName && (
                <p className="text-red-500 text-sm">{errors.firstName.message as string}</p>
              )}
            </div>
            <div>
              <Label htmlFor="lastName" className="font-black">LAST NAME</Label>
              <Input id="lastName" {...register("lastName")} />
              {errors.lastName && (
                <p className="text-red-500 text-sm">{errors.lastName.message as string}</p>
              )}
            </div>
            <div>
              <Label htmlFor="email" className="font-black">EMAIL</Label>
              <Input id="email" type="email" autoComplete="email" {...register("email")} />
              {errors.email && (
                <p className="text-red-500 text-sm">{errors.email.message as string}</p>
              )}
            </div>
            <div>
              <Label htmlFor="password" className="font-black">PASSWORD</Label>
              <PasswordInput
                id="password"
                autoComplete="new-password"
                {...register("password")}
              />
              {errors.password && (
                <p className="text-red-500 text-sm">{errors.password.message as string}</p>
              )}
            </div>
            <div>
              <Label htmlFor="passwordConfirm" className="font-black">CONFIRM PASSWORD</Label>
              <PasswordInput
                id="passwordConfirm"
                autoComplete="new-password"
                {...register("passwordConfirm")}
              />
              {errors.passwordConfirm && (
                <p className="text-red-500 text-sm">{errors.passwordConfirm.message as string}</p>
              )}
            </div>
            {!serverMode && (
              <label className="flex items-start gap-3 cursor-pointer select-none border-2 border-black p-3">
                <input
                  type="checkbox"
                  {...register("noLogin")}
                  className="mt-1 size-4 border-2 border-black accent-[#fd3777]"
                />
                <span className="text-sm">
                  <strong>Skip the login screen on this device.</strong> Open the
                  app straight to your notes without signing in each time. Admin
                  settings still ask for your password. You can change this later
                  in Admin → No-Login Mode. Only use this on a device you
                  physically control.
                </span>
              </label>
            )}
            <div className="border-2 border-black bg-yellow-100 p-3 text-sm">
              <p className="font-black">⚠ Write your password down somewhere safe.</p>
              <p className="mt-1">
                PrivateScribe is fully offline — there is no email reset and{" "}
                <span className="font-bold">no way to recover a forgotten password</span>.
                If you lose it, your notes stay encrypted and cannot be opened.
              </p>
            </div>
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <div className="flex justify-center items-center pt-2">
              <NeoButton
                label={submitting ? "Creating..." : "Create account"}
                backgroundColor="#fd3777"
                textColor="#ffffff"
                type="submit"
              />
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
