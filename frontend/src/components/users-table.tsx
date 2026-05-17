import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowUpDown } from "lucide-react";
import { useAuth } from "@/context/auth-context";
import ResetPasswordModal from "@/components/admin/ResetPasswordModal";
import Reset2FAModal from "@/components/admin/Reset2FAModal";
import DeactivateUserModal from "@/components/admin/DeactivateUserModal";
import ManageRolesModal from "@/components/admin/ManageRolesModal";

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  createdAt: string;
  lastLogin: string;
  twoFactorEnrolled?: boolean;
  isActive?: boolean;
  roles?: { id: string; name: string }[];
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
  const [reset2faTarget, setReset2faTarget] = useState<User | null>(null);
  const [activeTarget, setActiveTarget] = useState<
    { user: User; action: "deactivate" | "activate" } | null
  >(null);
  const [rolesTarget, setRolesTarget] = useState<User | null>(null);

  const handleSort = (key: keyof User) => {
    let direction: "asc" | "desc" = "asc";
    if (sortConfig && sortConfig.key === key && sortConfig.direction === "asc") {
      direction = "desc";
    }
    setSortConfig({ key, direction });

    const isDateColumn = key === "createdAt" || key === "lastLogin";
    const compareKey = (u: User): string | number => {
      const v = u[key];
      if (isDateColumn) {
        const t = new Date(v as string).getTime();
        return isNaN(t) ? -Infinity : t;
      }
      if (typeof v === "boolean") return v ? 1 : 0;
      // Non-sortable columns (e.g. roles) never reach here at runtime; the
      // string check keeps compareKey total now that keyof User is wider.
      return typeof v === "string" ? v : "";
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
  }, [users]);

  // Reflect an activate/deactivate without a full refetch.
  const setActive = (userId: string, isActive: boolean) => {
    setData((prev) => prev.map((u) => (u.id === userId ? { ...u, isActive } : u)));
  };

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
            <TableHead>Status</TableHead>
            <TableHead>2FA</TableHead>
            <TableHead>Roles</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((user) => {
            const isSelf = user.id === auth.user?.id;
            const isInactive = user.isActive === false;
            return (
              <TableRow key={user.id}>
                <TableCell className="text-xs">{user.id}</TableCell>
                <TableCell>{user.createdAt}</TableCell>
                <TableCell>{user.email}</TableCell>
                <TableCell>{user.firstName}</TableCell>
                <TableCell>{user.lastName}</TableCell>
                <TableCell>{user.lastLogin ? formatLocal(user.lastLogin) : 'No logins'}</TableCell>
                <TableCell>
                  <span
                    className={[
                      "inline-block px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider border-2 border-black",
                      isInactive ? "bg-red-200 text-red-900" : "bg-[#c6f6d5] text-green-900",
                    ].join(" ")}
                  >
                    {isInactive ? "Inactive" : "Active"}
                  </span>
                </TableCell>
                <TableCell>
                  <span
                    className={[
                      "inline-block px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider border-2 border-black",
                      user.twoFactorEnrolled ? "bg-[#ffff00]" : "bg-white text-muted-foreground",
                    ].join(" ")}
                  >
                    {user.twoFactorEnrolled ? "Enrolled" : "—"}
                  </span>
                </TableCell>
                <TableCell>
                  <button
                    type="button"
                    onClick={() => setRolesTarget(user)}
                    className="flex flex-wrap items-center gap-1 text-left hover:opacity-70"
                  >
                    {user.roles && user.roles.length > 0 ? (
                      user.roles.map((r) => (
                        <span
                          key={r.id}
                          className="inline-block border-2 border-black bg-[#fd3777] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white"
                        >
                          {r.name}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-muted-foreground underline">
                        Assign roles
                      </span>
                    )}
                  </button>
                </TableCell>
                <TableCell>
                  {isSelf ? (
                    <span className="text-xs text-muted-foreground">(you)</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setResetTarget(user)}
                      >
                        Reset password
                      </Button>
                      {user.twoFactorEnrolled && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setReset2faTarget(user)}
                        >
                          Reset 2FA
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setActiveTarget({
                            user,
                            action: isInactive ? "activate" : "deactivate",
                          })
                        }
                      >
                        {isInactive ? "Reactivate" : "Deactivate"}
                      </Button>
                    </div>
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
      {reset2faTarget && (
        <Reset2FAModal
          userId={reset2faTarget.id}
          userEmail={reset2faTarget.email}
          onClose={() => setReset2faTarget(null)}
          onSuccess={() => {
            setData((prev) =>
              prev.map((u) =>
                u.id === reset2faTarget.id ? { ...u, twoFactorEnrolled: false } : u
              )
            );
          }}
        />
      )}
      {activeTarget && (
        <DeactivateUserModal
          userId={activeTarget.user.id}
          userEmail={activeTarget.user.email}
          action={activeTarget.action}
          onClose={() => setActiveTarget(null)}
          onSuccess={() =>
            setActive(activeTarget.user.id, activeTarget.action === "activate")
          }
        />
      )}
      {rolesTarget && (
        <ManageRolesModal
          userId={rolesTarget.id}
          userEmail={rolesTarget.email}
          currentRoles={rolesTarget.roles ?? []}
          onClose={() => setRolesTarget(null)}
          onSaved={(roles) =>
            setData((prev) =>
              prev.map((u) => (u.id === rolesTarget.id ? { ...u, roles } : u)),
            )
          }
        />
      )}
    </>
  );
}
