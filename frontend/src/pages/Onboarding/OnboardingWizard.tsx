import { useState } from "react";
import { useNavigate } from "react-router";
import NeoButton from "@/components/neo/neo-button";

// The wizard walks a fresh admin through first-run setup. Welcome is the only
// step wired so far; recovery-key backup, the Ollama check, the Whisper
// notice, and use-case selection land in later commits — each inserted before
// the finish.
const TOTAL_STEPS = 1;

type StepProps = { onNext: () => void };

function WelcomeStep({ onNext }: StepProps) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl font-black uppercase">Welcome to PrivateScribe</h1>
      <p className="text-sm">
        PrivateScribe turns your recordings into clean, structured notes — and
        it does the whole job on this device. Your audio and your notes never
        leave your computer.
      </p>
      <p className="text-sm">
        This quick setup walks you through backing up your encryption key,
        checking that the AI engine is ready, and picking a few templates to
        start from.
      </p>
      <div className="flex justify-end pt-2">
        <NeoButton onClick={onNext} backgroundColor="#fd3777" textColor="#ffffff">
          Get started
        </NeoButton>
      </div>
    </div>
  );
}

export default function OnboardingWizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);

  // Advance to the next step, or finish the wizard on the last one.
  const next = () => {
    if (step < TOTAL_STEPS - 1) setStep(step + 1);
    else navigate("/notes/new", { replace: true });
  };

  return (
    <div className="min-h-screen flex justify-center items-start px-4 py-10">
      <div className="w-full max-w-xl border-4 border-black bg-white p-8 shadow-[8px_8px_0px_0px_#000000]">
        {step === 0 && <WelcomeStep onNext={next} />}
      </div>
    </div>
  );
}
