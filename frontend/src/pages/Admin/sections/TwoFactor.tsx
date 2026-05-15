import SectionHeader from "./SectionHeader";
import TwoFactorRequiredCard from "@/components/admin/TwoFactorRequiredCard";

export default function TwoFactorSection() {
  return (
    <>
      <SectionHeader
        title="Two-Factor Authentication"
        description="Require every user to confirm a one-time code from an authenticator app at sign-in."
      />
      <TwoFactorRequiredCard />
    </>
  );
}
