import { useEffect, useState } from "react";
import { useAuth } from "@/context/auth-context";
import UsersTable from "@/components/users-table";
import AddUserForm from "@/components/admin/AddUserForm";
import NeoButton from "@/components/neo/neo-button";
import SectionHeader from "./SectionHeader";

export default function UsersSection() {
  const auth = useAuth();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const response = await fetch("http://127.0.0.1:5000/api/getAllUsers", {
          headers: { Authorization: `Bearer ${auth.token}` },
        });
        if (!response.ok) throw new Error(`Server error: ${response.status}`);
        setUsers(await response.json());
      } catch (e: any) {
        setError(e.message ?? "Failed to load users");
      } finally {
        setLoading(false);
      }
    };
    fetchUsers();
  }, [auth.token]);

  return (
    <>
      <SectionHeader
        title="Users"
        description="Manage accounts that can sign in to this PrivateScribe install."
        actions={
          !showAddForm && (
            <NeoButton
              onClick={() => setShowAddForm(true)}
              backgroundColor="#fd3777"
              textColor="#ffffff"
            >
              Add User
            </NeoButton>
          )
        }
      />
      {showAddForm && (
        <div className="mb-6">
          <AddUserForm
            onSuccess={(newUser) => {
              setUsers((prev) => [...prev, newUser]);
              setShowAddForm(false);
            }}
            onCancel={() => setShowAddForm(false)}
          />
        </div>
      )}
      {loading && <p>Loading users...</p>}
      {error && <p className="text-red-600">Error: {error}</p>}
      {!loading && !error && <UsersTable users={users} />}
    </>
  );
}
