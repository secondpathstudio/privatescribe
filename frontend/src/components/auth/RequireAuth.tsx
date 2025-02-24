import { Navigate } from 'react-router'
import { useAuth } from "@/context/auth-context";
import { useEffect, useState } from 'react';

const RequireAuth = ({ children }: { children: JSX.Element }) => {
  const auth = useAuth();
  const [isValid, setIsValid] = useState(true);

  useEffect(() => {
    const validateToken = async () => {
      try {
        const response = await fetch('http://127.0.0.1:5000/api/validateToken', {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${auth.token}`,
          },
        });

        if (!response.ok) {
          if (response.status === 401) {
            auth.logout();
          }
          throw new Error('Network request failed with status ' + response.status);
        } else {
          setIsValid(true);
        }
      } catch (error) {
        auth.logout();
        setIsValid(false);
      }      
    };

    if (auth.token) {
      validateToken();
    } else {
      setIsValid(false);
    }
  }, [auth.token]);


  if (isValid === null) {
    return <div>Loading...</div>;
  }

  return isValid ? children : <Navigate to="/login" />;
};

export default RequireAuth;
