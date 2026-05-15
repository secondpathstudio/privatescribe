import SectionHeader from "./SectionHeader";
import ExportsEnabledCard from "@/components/admin/ExportsEnabledCard";

export default function ExportsSection() {
  return (
    <>
      <SectionHeader
        title="Document Exports"
        description="Allow users to download their notes as PDF or DOCX. Disable this for organizations that need notes to stay inside the app."
      />
      <ExportsEnabledCard />
    </>
  );
}
