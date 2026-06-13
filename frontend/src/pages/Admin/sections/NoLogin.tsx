import SectionHeader from "./SectionHeader";
import NoLoginModeCard from "@/components/admin/NoLoginModeCard";

export default function NoLoginSection() {
  return (
    <>
      <SectionHeader
        title="No-Login Mode"
        description="Skip the login screen on a personal device so you can jump straight to recording. Admin settings stay behind your password."
      />
      <NoLoginModeCard />
    </>
  );
}
