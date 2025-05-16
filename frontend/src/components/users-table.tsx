import { ColumnDef } from "@tanstack/react-table";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowUpDown } from "lucide-react";

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  createdAt: string;
  lastLogin: string;
}

export default function UsersTable({ users }: { users: User[] }) {
    const [data, setData] = useState<User[]>(users);
  const [sortConfig, setSortConfig] = useState<{ key: keyof User; direction: "asc" | "desc" } | null>(null);

  const handleSort = (key: keyof User) => {
    let direction: "asc" | "desc" = "asc";
    if (sortConfig && sortConfig.key === key && sortConfig.direction === "asc") {
      direction = "desc";
    }
    setSortConfig({ key, direction });

    const sortedData = [...data].sort((a, b) => {
      if (a[key] < b[key]) return direction === "asc" ? -1 : 1;
      if (a[key] > b[key]) return direction === "asc" ? 1 : -1;
      return 0;
    });

    setData(sortedData);
  };

    useEffect(() => {
        setData(users);
        console.log(users);
    }, [users]);


  return (
    <Table>
      <TableHeader>
        <TableRow>
          {[
            { key: "id", label: "ID" },
            { key: "createdAt", label: "Created At" },
            { key: "email", label: "Email" },
            { key: "firstName", label: "First Name" },
            { key: "lastName", label: "Last Name" },
            { key: "lastLogin", label: "Last Login" },
          ].map(({ key, label }) => (
            <TableHead key={key}>
              <Button variant="ghost" onClick={() => handleSort(key as keyof User)}>
                {label} <ArrowUpDown size={16} className="ml-2" />
              </Button>
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((user) => (
          <TableRow key={user.id}>
            <TableCell className="text-xs">{user.id}</TableCell>
            <TableCell>{user.createdAt}</TableCell>
            <TableCell>{user.email}</TableCell>
            <TableCell>{user.firstName}</TableCell>
            <TableCell>{user.lastName}</TableCell>
            <TableCell>{user.lastLogin}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
