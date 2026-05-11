import ModelsCard from "@/components/admin/ModelsCard";
import SectionHeader from "./SectionHeader";

export default function ModelsSection() {
  return (
    <>
      <SectionHeader
        title="Models"
        description="Local LLM models available via Ollama for template formatting."
      />
      <ModelsCard />
    </>
  );
}
