import NeoNavbar from "@/components/neo/neo-navbar";
import Navbar from "../components/Navbar";
import { Outlet } from "react-router";

export default function RootLayout() {
  return (
    <>
      <NeoNavbar />
      <Outlet />
    </>
  );
}
