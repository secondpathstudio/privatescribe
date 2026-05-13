import LoginForm from "@/components/login-form";
import { useAuth } from "@/context/auth-context";
import { Navigate } from "react-router";


export default function Login() {
  const auth = useAuth();

  // Client-side redirect — preserves in-memory state (notably the pending
  // backup-key modal) instead of doing a full page reload that wipes it.
  if (auth.token) {
    return <Navigate to="/notes" replace />;
  }

  return (
    <div className="max-w-screen-lg mx-auto px-4 py-10">
      <LoginForm />
    </div>
  );
}
