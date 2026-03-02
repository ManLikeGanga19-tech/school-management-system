import {
  principalNav,
  principalStudentsHref,
} from "@/components/layout/nav-config";
import { AllStudentsPage } from "@/components/students/AllStudentsPage";

export default function PrincipalAllStudentsPage() {
  return (
    <AllStudentsPage
      appTitle="Principal"
      nav={principalNav}
      activeHref={principalStudentsHref("all")}
      profileBasePath="/tenant/principal/students"
    />
  );
}
