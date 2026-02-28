import { secretaryNav, secretarySchoolSetupHref } from "@/components/layout/nav-config";
import { ClassesSetupPage } from "@/components/school-setup/ClassesSetupPage";

export default function SecretaryClassesSetupPage() {
  return (
    <ClassesSetupPage
      appTitle="Secretary"
      nav={secretaryNav}
      activeHref={secretarySchoolSetupHref("classes")}
    />
  );
}
