import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import NeoButton from "@/components/neo/neo-button";
import { useAuth } from "@/context/auth-context";

const schema = z
  .object({
    firstName: z.string().min(1, "First name is required"),
    lastName: z.string().min(1, "Last name is required"),
    email: z.string().email("Invalid email address"),
    password: z.string().min(6, "Password must be at least 6 characters"),
    confirmPassword: z.string(),
    role: z.enum(["user", "admin"]),
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
      const response = await fetch("http://127.0.0.1:5000/api/admin/users", {
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
          <Input id="password" type="password" autoComplete="new-password" {...register("password")} />
          {errors.password && <p className="text-red-500 text-sm">{errors.password.message as string}</p>}
        </div>
        <div>
          <Label htmlFor="confirmPassword">Confirm Password</Label>
          <Input id="confirmPassword" type="password" autoComplete="new-password" {...register("confirmPassword")} />
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
