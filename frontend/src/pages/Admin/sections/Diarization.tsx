import DiarizationDeviceCard from "@/components/admin/DiarizationDeviceCard";
import SectionHeader from "./SectionHeader";

export default function DiarizationSection() {
  return (
    <>
      <SectionHeader
        title="Diarization"
        description="Compute device used for speaker diarization (pyannote)."
      />
      <DiarizationDeviceCard />
    </>
  );
}
