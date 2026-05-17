import { Link, useLocation } from "react-router";
import { useAuth } from "@/context/auth-context";
import NeoButton from "./neo/neo-button";
import { NeoDropdown, NeoDropdownItem }  from "./neo/neo-dropdown";

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

    return (
        <NeoDropdown
            username={auth.user.firstName}
        >
            <NeoDropdownItem id="menu-account" route='/account'>
                Account
            </NeoDropdownItem>
            {auth.user.role === 'admin' && (
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