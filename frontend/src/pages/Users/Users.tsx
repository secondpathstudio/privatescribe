import UsersTable from "@/components/users-table";
import { useEffect, useState } from "react";

export default function Users() {
  const [users, setUsers] = useState<any>([]);

  const getAllUsers = async () => {
    try {
      const response = await fetch('http://127.0.0.1:5000/api/getAllUsers');
      const data = await response.json();
      setUsers(data);
    } catch (error) {
      console.error("Error:", error);
      alert("Network error. Try again.");
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
