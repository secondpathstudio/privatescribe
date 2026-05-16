import SectionHeader from "./SectionHeader";
import SessionCard from "@/components/admin/SessionCard";

export default function SessionSection() {
  return (
    <>
      <SectionHeader
        title="Session"
        description="Idle auto sign-out, and how the desktop app handles credentials between launches."
      />
      <SessionCard />
    </>
  );
}
