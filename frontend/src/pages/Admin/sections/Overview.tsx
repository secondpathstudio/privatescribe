import { Link } from "react-router";
import SectionHeader from "./SectionHeader";

type Card = {
  to: string;
  title: string;
  description: string;
};

const CARDS: Card[] = [
  { to: "/admin/users", title: "Users", description: "Accounts, roles, and access." },
  { to: "/admin/audit-log", title: "Audit Log", description: "Who did what, when, and from where." },
  { to: "/admin/encryption", title: "Encryption", description: "Backup and rotate the SQLCipher key." },
  { to: "/admin/templates", title: "Templates", description: "Manage templates across users." },
  { to: "/admin/models", title: "Models", description: "Local Ollama models available for formatting." },
  { to: "/admin/upload-limit", title: "Upload Limit", description: "Cap audio upload size." },
  { to: "/admin/diarization", title: "Diarization", description: "Compute device for speaker separation." },
];

export default function OverviewSection() {
  return (
    <>
      <SectionHeader
        title="Overview"
        description="Admin home. Pick an area from the left or jump to one below."
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {CARDS.map((c) => (
          <Link
            key={c.to}
            to={c.to}
            className="block border-2 border-black bg-white p-4 hover:bg-gray-50 transition-colors"
          >
            <div className="font-black text-lg">{c.title}</div>
            <div className="text-sm text-muted-foreground mt-1">{c.description}</div>
          </Link>
        ))}
      </div>
    </>
  );
}
