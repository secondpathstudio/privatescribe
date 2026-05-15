import SectionHeader from "./SectionHeader";
import DictationMarkersCard from "@/components/admin/DictationMarkersCard";

export default function DictationMarkersSection() {
  return (
    <>
      <SectionHeader
        title="Dictation Commands"
        description="Translate spoken formatting commands (e.g. 'new paragraph') into real line breaks after transcription. Useful for solo dictation; turn off if your recordings rarely include such commands and false positives are a concern."
      />
      <DictationMarkersCard />
    </>
  );
}
