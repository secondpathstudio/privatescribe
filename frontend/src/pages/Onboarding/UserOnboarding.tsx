import { useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { API_BASE } from "@/lib/api";
import { useAuth } from "@/context/auth-context";
import NeoButton from "@/components/neo/neo-button";

// A brief, informational intro shown to a new non-admin user on first login
// (route /getting-started). Unlike the admin wizard it backs up no key, checks
// nothing, and seeds nothing — it just explains templates and notes.
const STEPS = [
  {
    title: "Welcome to PrivateScribe",
    body: [
      "PrivateScribe turns your recordings into clean, written notes — transcription and formatting both happen on this device, so nothing you record ever leaves your computer.",
      "Here's a quick tour of how it works.",
    ],
  },
  {
    title: "Templates",
    body: [
      "A template is the shape of a finished note — its headings and sections. When you create a note you pick a template, and the AI fills it in from what you said.",
      "You build your own templates for the kinds of notes you take, anytime from the Templates page.",
    ],
  },
  {
    title: "Making a note",
    body: [
      "To make a note: start a new note, choose a template, then record audio or upload a file.",
      "PrivateScribe transcribes the audio, formats it with your template, and hands it back to you to review, edit, and save.",
    ],
  },
];

export default function UserOnboarding() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [finishing, setFinishing] = useState(false);

  // Already finished the intro — don't replay it.
  if (auth.user?.hasOnboarded) return <Navigate to="/notes" replace />;

  const finish = async () => {
    setFinishing(true);
    try {
      await fetch(`${API_BASE}/api/onboarding/user-complete`, {
        method: "POST",
        headers: { Authorization: `Bearer ${auth.token}` },
      });
    } catch {
      // Non-fatal — worst case the intro shows again on the next login.
    }
    navigate("/notes", { replace: true });
  };

  const next = () => {
    if (step < STEPS.length - 1) setStep(step + 1);
    else finish();
  };

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <div className="min-h-screen flex justify-center items-start px-4 py-10">
      <div className="w-full max-w-xl border-4 border-black bg-white p-8 shadow-[8px_8px_0px_0px_#000000]">
        <div className="flex flex-col gap-4">
          <h1 className="text-3xl font-black uppercase">{current.title}</h1>
          {current.body.map((paragraph, i) => (
            <p key={i} className="text-sm">{paragraph}</p>
          ))}
          <div className="flex items-center justify-between pt-2">
            {step > 0 ? (
              <NeoButton onClick={() => setStep(step - 1)} disabled={finishing}>
                Back
              </NeoButton>
            ) : (
              <span />
            )}
            <NeoButton
              onClick={next}
              disabled={finishing}
              backgroundColor="#fd3777"
              textColor="#ffffff"
            >
              {isLast ? (finishing ? "Finishing…" : "Get started") : "Next"}
            </NeoButton>
          </div>
        </div>
      </div>
    </div>
  );
}
