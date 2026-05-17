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

const setupSchema = z
  .object({
    organization: z.string().min(1, "Required"),
    firstName: z.string().min(1, "Required"),
    lastName: z.string().min(1, "Required"),
    email: z.string().email("Invalid email address"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    passwordConfirm: z.string(),
  })
  .refine((d) => d.password === d.passwordConfirm, {
    message: "Passwords do not match",
    path: ["passwordConfirm"],
  });

type SetupFormProps = {
  onDone?: () => void;
};

export default function SetupForm({ onDone }: SetupFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({ resolver: zodResolver(setupSchema) });
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
          organization: formData.organization,
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
          <CardTitle className="text-2xl font-black">SET UP YOUR APP</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Welcome — create your organization and admin account to get
            started. Your encryption key will be generated automatically;
            back it up after sign-in.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
            <div>
              <Label htmlFor="organization" className="font-black">ORGANIZATION</Label>
              <Input id="organization" maxLength={255} autoComplete="organization" {...register("organization")} />
              {errors.organization && (
                <p className="text-red-500 text-sm">{errors.organization.message as string}</p>
              )}
            </div>
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
