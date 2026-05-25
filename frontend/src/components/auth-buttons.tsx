import { Link, useLocation } from "react-router";
import { useAuth } from "@/context/auth-context";
import { isAdmin, isSuperAdmin } from "@/lib/roles";
import NeoButton from "./neo/neo-button";
import { NeoDropdown, NeoDropdownItem }  from "./neo/neo-dropdown";

// Central IT (super-admin) accent — the purple already used on the logout item,
// reused to mark the elevated, cross-organization role across the app.
const SUPER_ADMIN_PURPLE = "#5d1d91";

export default function AuthButtons() {
    const auth = useAuth();
    const location = useLocation();

    if (!auth.user) {
        // Already on the login screen — no point offering a Login button.
        if (location.pathname === "/login") return null;

        // Use <Link>, not <a href>: the desktop app runs under HashRouter
        // (file:// URLs), where a plain anchor navigates to a nonexistent
        // file path and lands on a blank page.
        return (
            <Link to="/login">
                <NeoButton
                    label="Login"
                    backgroundColor="#fd3777"
                    textColor="#ffffff"
                />
            </Link>
    )}

    const superAdmin = isSuperAdmin(auth.user.role);

    return (
        <NeoDropdown
            username={auth.user.firstName}
            backgroundColor={superAdmin ? SUPER_ADMIN_PURPLE : undefined}
            textColor={superAdmin ? "#ffffff" : undefined}
            badge={superAdmin ? (
                <span className="rounded-sm bg-white px-1.5 py-0.5 text-[10px] font-black tracking-wider text-[#5d1d91]">
                    Super Admin
                </span>
            ) : undefined}
        >
            <NeoDropdownItem id="menu-account" route='/account'>
                Account
            </NeoDropdownItem>
            {isAdmin(auth.user.role) && (
                <NeoDropdownItem id="menu-admin" route='/admin'>
                    Admin
                </NeoDropdownItem>
            )}
            <NeoDropdownItem id="menu-logout" className="border-t-4 hover:border-t-4 border-black bg-[#5d1d91] text-white">
                <button className="flex items-center cursor-pointer w-full h-full p-3" onClick={() => auth.logout()}>
                    <span>LOGOUT</span>
                </button>
            </NeoDropdownItem>
        </NeoDropdown>
    )
}