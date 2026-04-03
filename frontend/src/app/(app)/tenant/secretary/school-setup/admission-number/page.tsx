import { secretaryNav, secretarySchoolSetupHref } from "@/components/layout/nav-config";
import { AdmissionNumberPage } from "@/components/school-setup/AdmissionNumberPage";

export default function SecretaryAdmissionNumberPage() {
  return (
    <AdmissionNumberPage
      title="Secretary"
      nav={secretaryNav}
      activeHref={secretarySchoolSetupHref("admission-number")}
      readOnly
    />
  );
}
