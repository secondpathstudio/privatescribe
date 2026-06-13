import { API_BASE } from "@/lib/api";
import { isAdmin } from "@/lib/roles";
import { Navigate } from 'react-router'
import { useAuth } from "@/context/auth-context";
import { useEffect, useState } from 'react';
import ElevationGate from "@/components/auth/ElevationGate";

const RequireAdmin = ({ children }: { children: JSX.Element }) => {
  const auth = useAuth();
  const [status, setStatus] = useState<'checking' | 'allow' | 'deny'>('checking');
  // A no-login (kiosk) session can carry an admin identity, but admin routes
  // stay locked until the user re-enters their password (step-up). The backend
  // enforces this too — this just decides whether to show the elevation modal.
  const [kiosk, setKiosk] = useState(false);

  useEffect(() => {
    const validate = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/validateToken`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${auth.token}`,
          },
        });

        if (!response.ok) {
          if (response.status === 401) auth.logout();
          setStatus('deny');
          return;
        }

        const data = await response.json();
        if (!isAdmin(data.user?.role)) {
          setStatus('deny');
          return;
        }
        setKiosk(!!data.user?.kiosk);
        setStatus('allow');
      } catch {
        auth.logout();
        setStatus('deny');
      }
    };

    if (auth.token) validate();
    else setStatus('deny');
  }, [auth.token]);

  if (status === 'checking') return <div>Loading...</div>;
  if (status === 'deny') return <Navigate to="/login" />;
  // Elevating swaps in a non-kiosk token, which re-runs the effect above and
  // drops us through to the real admin content.
  if (kiosk) return <ElevationGate />;
  return children;
};

export default RequireAdmin;
