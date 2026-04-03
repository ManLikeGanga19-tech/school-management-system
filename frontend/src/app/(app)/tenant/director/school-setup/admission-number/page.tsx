import { directorNav, directorSchoolSetupHref } from "@/components/layout/nav-config";
import { AdmissionNumberPage } from "@/components/school-setup/AdmissionNumberPage";

export default function DirectorAdmissionNumberPage() {
  return (
    <AdmissionNumberPage
      title="Director"
      nav={directorNav}
      activeHref={directorSchoolSetupHref("admission-number")}
    />
  );
}
