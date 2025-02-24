import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Avatar, AvatarFallback} from "./ui/avatar";

export default function AuthButtons() {
    //handle auth state

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
                    <a className='cursor-pointer' href="/profile">Profile</a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                    <button className="cursor-pointer" onClick={() => console.log('handle logout')}>Logout</button>
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}