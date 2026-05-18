import SectionHeader from "./SectionHeader";
import PasswordPolicyCard from "@/components/admin/PasswordPolicyCard";
import AccountLockoutCard from "@/components/admin/AccountLockoutCard";

export default function PasswordPolicySection() {
  return (
    <>
      <SectionHeader
        title="Password Policy"
        description="Password-strength rules, and the brute-force lockout that protects every sign-in."
      />
      <div className="space-y-6">
        <PasswordPolicyCard />
        <AccountLockoutCard />
      </div>
    </>
  );
}
