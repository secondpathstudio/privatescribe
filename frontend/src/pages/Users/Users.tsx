import { API_BASE } from "@/lib/api";
import { toast } from "sonner";
import UsersTable from "@/components/users-table";
import { useEffect, useState } from "react";

export default function Users() {
  const [users, setUsers] = useState<any>([]);

  const getAllUsers = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/getAllUsers`);
      const data = await response.json();
      setUsers(data);
    } catch (error) {
      console.error("Error:", error);
      toast.error("Network error. Try again.");
    }
  }

  useEffect(() => {
    getAllUsers();
  }, []);

  return (
    <div className="max-w-screen-lg mx-auto px-4 py-10">
      <UsersTable users={users} />
    </div>
  );
}
