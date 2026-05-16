import AudioStorageCard from "@/components/admin/AudioStorageCard";
import SectionHeader from "./SectionHeader";

export default function AudioStorageSection() {
  return (
    <>
      <SectionHeader
        title="Audio Storage"
        description="Whether transcription recordings are kept, and how long they're retained before deletion."
      />
      <AudioStorageCard />
    </>
  );
}
