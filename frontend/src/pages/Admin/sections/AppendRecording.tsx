import SectionHeader from "./SectionHeader";
import AppendRecordingCard from "@/components/admin/AppendRecordingCard";

export default function AppendRecordingSection() {
  return (
    <>
      <SectionHeader
        title="Append Recordings"
        description="Allow users to add further recordings to a note while it is still a draft, merging each new transcript onto the existing one. Locks once a note is approved, finalized, or signed."
      />
      <AppendRecordingCard />
    </>
  );
}
