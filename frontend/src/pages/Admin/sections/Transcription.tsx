import SectionHeader from "./SectionHeader";
import VocabularyEditor from "@/components/transcription/VocabularyEditor";
import AbbreviationsEditor from "@/components/transcription/AbbreviationsEditor";
import WhisperModelCard from "@/components/admin/WhisperModelCard";
import SttEngineCard from "@/components/admin/SttEngineCard";

export default function TranscriptionSection() {
  return (
    <>
      <SectionHeader
        title="Transcription engine"
        description="Which speech-to-text engine turns recordings into text, and which Whisper model size it uses. Switching downloads any weights up front so the app keeps running offline afterward."
      />
      <div className="space-y-6 mb-8">
        <SttEngineCard />
        <WhisperModelCard />
      </div>

      <SectionHeader
        title="Vocabulary & Abbreviations"
        description="Org-wide transcription overlays. Vocabulary biases Whisper toward expected terms; abbreviations expand short forms into long forms in the raw transcript before the AI pass. Each user can layer their own additions on top in their Account page."
      />
      <div className="space-y-6">
        <VocabularyEditor
          endpoint="/api/admin/settings/vocabulary"
          title="Custom vocabulary"
          description="Domain terms Whisper should expect — drug names, frequent patient names, jargon. Whisper biases recognition toward these as if it had just heard them, so accuracy improves on hard-to-recognize words."
        />
        <AbbreviationsEditor
          endpoint="/api/admin/settings/abbreviations"
          title="Abbreviations"
          description="Short forms that should be expanded to long forms in every user's transcript after Whisper finishes. Users can add their own and override these entries in their Account page."
        />
      </div>
    </>
  );
}
