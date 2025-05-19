import { useAuth } from "@/context/auth-context";
import NeoButton from "./neo/neo-button";
import { NeoDropdown, NeoDropdownItem }  from "./neo/neo-dropdown";

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
        >
            <NeoDropdownItem id="menu-1" route="/notes">
                Notes
            </NeoDropdownItem>
            <NeoDropdownItem id="menu-2" route='/templates'>
                Templates
            </NeoDropdownItem>
            <NeoDropdownItem id="menu-3" className="border-t-4 hover:border-t-4 border-black bg-[#5d1d91] text-white">
                <button className="flex items-center cursor-pointer w-full h-full p-3" onClick={() => auth.logout()}>
                    <span>LOGOUT</span>
                </button>
            </NeoDropdownItem>
        </NeoDropdown>
    )
}