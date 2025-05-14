import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Avatar, AvatarFallback} from "./ui/avatar";
import { useAuth } from "@/context/auth-context";
import { Link } from "react-router";
import NeoButton from "./neo/neo-button";

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
        <DropdownMenu>
            <DropdownMenuTrigger>
                <NeoButton
                    label={`${auth.user?.firstName}`}
                    backgroundColor="#fd3777"
                    textColor="#ffffff"
                    />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
                <DropdownMenuLabel>
                    <div>{auth.user?.firstName} {auth.user?.lastName}</div>
                    <div className="font-normal text-xs">{auth.user?.email}</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                    <Link className='cursor-pointer' to="/notes">Notes</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                    <Link className='cursor-pointer' to="/users">Users</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                    <Link className='cursor-pointer' to="/templates">Templates</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                    <button className="cursor-pointer" onClick={() => auth.logout()}>Logout</button>
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}