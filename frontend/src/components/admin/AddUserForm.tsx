import { API_BASE } from "@/lib/api";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import NeoButton from "@/components/neo/neo-button";
import { useAuth } from "@/context/auth-context";
import { isSuperAdmin } from "@/lib/roles";

const schema = z
  .object({
    firstName: z.string().min(1, "First name is required"),
    lastName: z.string().min(1, "Last name is required"),
    email: z.string().email("Invalid email address"),
    // Loosest possible backend floor (the "standard" policy). The active
    // policy may demand more — "strict" requires 12 chars + character-class
    // rules — and the server enforces it, surfacing any violation as serverError.
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
    role: z.enum(["user", "admin"]),
    // Super-admin only: which organization to place the user in. Org-admins
    // omit it and the backend uses their own org.
    organizationId: z.string().optional(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type Props = {
  onSuccess: (user: any) => void;
  onCancel: () => void;
};

export default function AddUserForm({ onSuccess, onCancel }: Props) {
  const auth = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const superAdmin = isSuperAdmin(auth.user?.role);
  const [orgs, setOrgs] = useState<{ id: string; name: string }[]>([]);

  // Super-admins choose which department a new user joins; load the list.
  useEffect(() => {
    if (!superAdmin) return;
    fetch(`${API_BASE}/api/admin/organization/list`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    })
      .then((r) => (r.ok ? r.json() : { organizations: [] }))
      .then((d) => setOrgs(d.organizations ?? []))
      .catch(() => setOrgs([]));
  }, [superAdmin, auth.token]);

  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
  } = useForm({
    resolver: zodResolver(schema),
    mode: "onChange",
    defaultValues: { role: "user" as const },
  });

  const onSubmit = async (formData: any) => {
    setIsSubmitting(true);
    setServerError(null);
    try {
      const response = await fetch(`${API_BASE}/api/admin/users`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${auth.token}`,
        },
        body: JSON.stringify({
          firstName: formData.firstName,
          lastName: formData.lastName,
          email: formData.email,
          password: formData.password,
          role: formData.role,
          // Only meaningful for a super-admin; backend ignores it otherwise.
          ...(formData.organizationId ? { organizationId: formData.organizationId } : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setServerError(data.error || "Failed to create user");
        return;
      }
      onSuccess(data);
    } catch (e: any) {
      setServerError(e.message || "Network error");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mb-6 p-4 border rounded-md">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="firstName">First Name</Label>
          <Input id="firstName" {...register("firstName")} />
          {errors.firstName && <p className="text-red-500 text-sm">{errors.firstName.message as string}</p>}
        </div>
        <div>
          <Label htmlFor="lastName">Last Name</Label>
          <Input id="lastName" {...register("lastName")} />
          {errors.lastName && <p className="text-red-500 text-sm">{errors.lastName.message as string}</p>}
        </div>
      </div>
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" autoComplete="off" {...register("email")} />
        {errors.email && <p className="text-red-500 text-sm">{errors.email.message as string}</p>}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="password">Password</Label>
          <PasswordInput id="password" autoComplete="new-password" {...register("password")} />
          {errors.password && <p className="text-red-500 text-sm">{errors.password.message as string}</p>}
        </div>
        <div>
          <Label htmlFor="confirmPassword">Confirm Password</Label>
          <PasswordInput id="confirmPassword" autoComplete="new-password" {...register("confirmPassword")} />
          {errors.confirmPassword && <p className="text-red-500 text-sm">{errors.confirmPassword.message as string}</p>}
        </div>
      </div>
      <div>
        <Label htmlFor="role">Role</Label>
        <select
          id="role"
          className="block w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          {...register("role")}
        >
          <option value="user">User</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      {superAdmin && (
        <div>
          <Label htmlFor="organizationId">Organization</Label>
          <select
            id="organizationId"
            className="block w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            defaultValue=""
            {...register("organizationId")}
          >
            <option value="">— None (central) —</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>
      )}
      {serverError && <p className="text-red-500 text-sm">{serverError}</p>}
      <div className="flex gap-4 pt-2">
        <NeoButton
          type="submit"
          disabled={isSubmitting || !isValid}
          backgroundColor="#fd3777"
          textColor="#ffffff"
        >
          {isSubmitting ? "Creating..." : "Create User"}
        </NeoButton>
        <NeoButton
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          Cancel
        </NeoButton>
      </div>
    </form>
  );
}
