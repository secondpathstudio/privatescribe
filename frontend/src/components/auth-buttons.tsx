import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Avatar, AvatarFallback} from "./ui/avatar";
import { useAuth } from "@/context/auth-context";

export default function AuthButtons() {
    const auth = useAuth();

    const logout = () => {
        localStorage.removeItem("access_token");
        localStorage.removeItem("refresh_token");
        window.location.href = "/login"; // Redirect
      };

    return (
        <DropdownMenu>
            <DropdownMenuTrigger>
                <Avatar>
                    <AvatarFallback className="bg-gray-500">
                        {auth.user ? auth.user.firstName[0] : 'U'}{auth.user ? auth.user.lastName[0] : 'S'}
                    </AvatarFallback>
                </Avatar>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
                <DropdownMenuLabel>
                    <div>{auth.user?.firstName} {auth.user?.lastName}</div>
                    <div className="font-normal text-xs">{auth.user?.email}</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                    <a className='cursor-pointer' href="/notes">Notes</a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                    <a className='cursor-pointer' href="/users">Users</a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                    <a className='cursor-pointer' href="/login">Login</a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                    <a className='cursor-pointer' href="/signup">Sign Up</a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                    <button className="cursor-pointer" onClick={logout}>Logout</button>
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}