import {
  secretaryNav,
  secretaryStudentsHref,
} from "@/components/layout/nav-config";
import { AllStudentsPage } from "@/components/students/AllStudentsPage";

export default function SecretaryAllStudentsPage() {
  return (
    <AllStudentsPage
      appTitle="Secretary"
      nav={secretaryNav}
      activeHref={secretaryStudentsHref("all")}
      profileBasePath="/tenant/secretary/students"
    />
  );
}
