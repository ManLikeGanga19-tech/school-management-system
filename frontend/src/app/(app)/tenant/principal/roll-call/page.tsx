import { principalNav } from "@/components/layout/nav-config";
import { RollCallPage } from "@/components/attendance/RollCallPage";

export default function PrincipalRollCallPage() {
  return (
    <RollCallPage
      appTitle="Principal"
      nav={principalNav}
      activeHref="/tenant/principal/roll-call"
      profileBasePath="/tenant/principal/students"
    />
  );
}
