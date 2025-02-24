import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Avatar, AvatarFallback} from "./ui/avatar";

export default function AuthButtons() {
    //handle auth state

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
                        User
                    </AvatarFallback>
                </Avatar>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
                <DropdownMenuLabel>
                    <div>User Name</div>
                    <div className="font-normal text-xs">User Email</div>
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