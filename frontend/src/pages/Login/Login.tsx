import LoginForm from "@/components/login-form";
import { useAuth } from "@/context/auth-context";


export default function Login() {
  const auth = useAuth();

  if (auth.token) {
    window.location.href = "/notes";
    return null;
  }

  return (
    <div className="max-w-screen-lg mx-auto px-4 py-10">
      <LoginForm />
    </div>
  );
}
