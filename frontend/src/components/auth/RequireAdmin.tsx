import { Navigate } from 'react-router'
import { useAuth } from "@/context/auth-context";
import { useEffect, useState } from 'react';

const RequireAdmin = ({ children }: { children: JSX.Element }) => {
  const auth = useAuth();
  const [status, setStatus] = useState<'checking' | 'allow' | 'deny'>('checking');

  useEffect(() => {
    const validate = async () => {
      try {
        const response = await fetch('http://127.0.0.1:5000/api/validateToken', {
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
        setStatus(data.user?.role === 'admin' ? 'allow' : 'deny');
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
  return children;
};

export default RequireAdmin;
