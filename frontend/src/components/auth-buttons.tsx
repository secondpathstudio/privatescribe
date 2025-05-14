import { useAuth } from "@/context/auth-context";
import { Link } from "react-router";
import NeoButton from "./neo/neo-button";
import NeoDropdownExample, { NeoDropdown, NeoDropdownItem }  from "./neo/neo-dropdown";

export default function AuthButtons() {
    const auth = useAuth();

    if (!auth.user) {
        return (
            <a href="/login">
                <NeoButton
                    label="Login"
                    backgroundColor="#fd3777"
                    textColor="#ffffff"
                />
            </a>
    )}

    return (
        <NeoDropdown 
            username={auth.user.firstName}
            onChange={(id: string) => console.log(`Selected item with ID: ${id}`)}
        >
            <NeoDropdownItem id="menu-1">
                <Link to="/notes">
                    <div className="flex items-center">
                        <span>Notes</span>
                    </div>
                </Link>
            </NeoDropdownItem>
            <NeoDropdownItem id="menu-2">
                <Link to="/templates">
                    <div className="flex items-center">
                        <span>Templates</span>
                    </div>
                </Link>
            </NeoDropdownItem>
            <NeoDropdownItem id="menu-3" className="border-t-4 hover:border-t-4 border-black">
                <button className="flex items-center cursor-pointer" onClick={() => auth.logout()}>
                    <span>LOGOUT</span>
                </button>
            </NeoDropdownItem>
        </NeoDropdown>
    )
}