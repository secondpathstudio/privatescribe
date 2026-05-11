import UploadLimitCard from "@/components/admin/UploadLimitCard";
import SectionHeader from "./SectionHeader";

export default function UploadLimitSection() {
  return (
    <>
      <SectionHeader
        title="Upload Limit"
        description="Maximum size for audio uploads to /api/transcribe."
      />
      <UploadLimitCard />
    </>
  );
}
