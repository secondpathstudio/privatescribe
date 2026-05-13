import TrashRetentionCard from "@/components/admin/TrashRetentionCard";
import SectionHeader from "./SectionHeader";

export default function TrashRetentionSection() {
  return (
    <>
      <SectionHeader
        title="Trash & Retention"
        description="How long deleted notes and templates are kept before they can be permanently removed."
      />
      <TrashRetentionCard />
    </>
  );
}
