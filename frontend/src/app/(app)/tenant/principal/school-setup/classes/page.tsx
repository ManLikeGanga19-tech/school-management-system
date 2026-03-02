import {
  principalNav,
  principalSchoolSetupHref,
} from "@/components/layout/nav-config";
import { ClassesSetupPage } from "@/components/school-setup/ClassesSetupPage";

export default function PrincipalClassesSetupPage() {
  return (
    <ClassesSetupPage
      appTitle="Principal"
      nav={principalNav}
      activeHref={principalSchoolSetupHref("classes")}
    />
  );
}
