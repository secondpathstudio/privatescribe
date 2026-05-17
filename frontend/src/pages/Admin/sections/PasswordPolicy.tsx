import SectionHeader from "./SectionHeader";
import PasswordPolicyCard from "@/components/admin/PasswordPolicyCard";

export default function PasswordPolicySection() {
  return (
    <>
      <SectionHeader
        title="Password Policy"
        description="Choose how strong a password every account is required to set."
      />
      <PasswordPolicyCard />
    </>
  );
}
