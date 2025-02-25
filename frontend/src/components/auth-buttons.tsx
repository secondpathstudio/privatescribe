import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Avatar, AvatarFallback} from "./ui/avatar";
import { useAuth } from "@/context/auth-context";
import { Link } from "react-router";

export default function AuthButtons() {
    const auth = useAuth();

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
                    <Link className='cursor-pointer' to="/notes">Notes</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                    <Link className='cursor-pointer' to="/users">Users</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                    <Link className='cursor-pointer' to="/login">Login</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                    <Link className='cursor-pointer' to="/signup">Sign Up</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                    <button className="cursor-pointer" onClick={() => auth.logout()}>Logout</button>
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}