import NeoNavbar from "@/components/neo/neo-navbar";
import Navbar from "../components/Navbar";
import ForcePasswordChangeGate from "@/components/auth/ForcePasswordChangeGate";
import { Outlet } from "react-router";

export default function RootLayout() {
  return (
    <>
      <NeoNavbar />
      <ForcePasswordChangeGate />
      <Outlet />
    </>
  );
}
