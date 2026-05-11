import { ColumnDef } from "@tanstack/react-table";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowUpDown } from "lucide-react";
import { useAuth } from "@/context/auth-context";
import ResetPasswordModal from "@/components/admin/ResetPasswordModal";

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  createdAt: string;
  lastLogin: string;
}

const formatLocal = (value?: string) => {
  if (!value) return '—';
  const d = new Date(value);
  return isNaN(d.getTime()) ? value : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

export default function UsersTable({ users }: { users: User[] }) {
    const auth = useAuth();
    const [data, setData] = useState<User[]>(users);
  const [sortConfig, setSortConfig] = useState<{ key: keyof User; direction: "asc" | "desc" } | null>(null);
  const [resetTarget, setResetTarget] = useState<User | null>(null);

  const handleSort = (key: keyof User) => {
    let direction: "asc" | "desc" = "asc";
    if (sortConfig && sortConfig.key === key && sortConfig.direction === "asc") {
      direction = "desc";
    }
    setSortConfig({ key, direction });

    const isDateColumn = key === "createdAt" || key === "lastLogin";
    const compareKey = (u: User) => {
      const v = u[key];
      if (isDateColumn) {
        const t = new Date(v as string).getTime();
        return isNaN(t) ? -Infinity : t;
      }
      return v;
    };

    const sortedData = [...data].sort((a, b) => {
      const av = compareKey(a);
      const bv = compareKey(b);
      if (av < bv) return direction === "asc" ? -1 : 1;
      if (av > bv) return direction === "asc" ? 1 : -1;
      return 0;
    });

    setData(sortedData);
  };

    useEffect(() => {
        setData(users);
        console.log(users);
    }, [users]);


  return (
    <>
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
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((user) => {
            const isSelf = user.id === auth.user?.id;
            return (
              <TableRow key={user.id}>
                <TableCell className="text-xs">{user.id}</TableCell>
                <TableCell>{user.createdAt}</TableCell>
                <TableCell>{user.email}</TableCell>
                <TableCell>{user.firstName}</TableCell>
                <TableCell>{user.lastName}</TableCell>
                <TableCell>{user.lastLogin ? formatLocal(user.lastLogin) : 'No logins'}</TableCell>
                <TableCell>
                  {isSelf ? (
                    <span className="text-xs text-muted-foreground">(you)</span>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setResetTarget(user)}
                    >
                      Reset password
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {resetTarget && (
        <ResetPasswordModal
          userId={resetTarget.id}
          userEmail={resetTarget.email}
          onClose={() => setResetTarget(null)}
        />
      )}
    </>
  );
}
