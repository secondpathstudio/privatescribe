import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/auth-context";
import { redirect } from "react-router";
import NeoButton from "./neo/neo-button";

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export default function LoginForm() {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(loginSchema),
  });

  const auth = useAuth();

  const onSubmit = async (formData: any) => {
    try {
        const response = await fetch('http://127.0.0.1:5000/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                email: formData.email,
                password: formData.password
            }),
        });

        const data = await response.json();

        if (response.ok) {
            console.log("Login successful:", data);
            auth.login(data.access_token, data.refresh_token, data.user);
            redirect("/notes");
        } else {
            alert(data.error || "Login failed");
        }
      } catch (error) {
        console.error("Error:", error);
        alert("Login error. Try again.");
      }
  };

  return (
    <div className="flex justify-center items-center">
      <Card className="w-96">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-black">LOGIN</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <Label htmlFor="email">EMAIL</Label>
              <Input id="email" type="email" {...register("email")} />
              {errors.email && <p className="text-red-500 text-sm">{errors.email.message}</p>}
            </div>
            <div>
              <Label htmlFor="password">PASSWORD</Label>
              <Input id="password" type="password" {...register("password")} />
              {errors.password && <p className="text-red-500 text-sm">{errors.password.message}</p>}
            </div>
            <div className="flex justify-center items-center">
              <NeoButton label="Login" backgroundColor="#fd3777" textColor="#ffffff" type="submit" />
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
