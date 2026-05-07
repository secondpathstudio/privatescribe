import { useEffect, useState } from "react";
import { useAuth } from "@/context/auth-context";
import UsersTable from "@/components/users-table";
import AddUserForm from "@/components/admin/AddUserForm";
import NeoButton from "@/components/neo/neo-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function Admin() {
  const auth = useAuth();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const response = await fetch('http://127.0.0.1:5000/api/getAllUsers', {
          headers: {
            'Authorization': `Bearer ${auth.token}`,
          },
        });
        if (!response.ok) throw new Error(`Server error: ${response.status}`);
        setUsers(await response.json());
      } catch (e: any) {
        setError(e.message ?? 'Failed to load users');
      } finally {
        setLoading(false);
      }
    };
    fetchUsers();
  }, [auth.token]);

  return (
    <div className="max-w-screen-lg mx-auto px-4 py-10 space-y-6">
      <h1 className="text-4xl font-black">Admin</h1>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Users</CardTitle>
            {!showAddForm && (
              <NeoButton
                onClick={() => setShowAddForm(true)}
                backgroundColor="#fd3777"
                textColor="#ffffff"
              >
                Add User
              </NeoButton>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {showAddForm && (
            <AddUserForm
              onSuccess={(newUser) => {
                setUsers((prev) => [...prev, newUser]);
                setShowAddForm(false);
              }}
              onCancel={() => setShowAddForm(false)}
            />
          )}
          {loading && <p>Loading users...</p>}
          {error && <p className="text-red-600">Error: {error}</p>}
          {!loading && !error && <UsersTable users={users} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Templates</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">Coming soon: review and manage all templates across users.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>System</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">Coming soon: model status, storage usage, audit log.</p>
        </CardContent>
      </Card>
    </div>
  );
}
