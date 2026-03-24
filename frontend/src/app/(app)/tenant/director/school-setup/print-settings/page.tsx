import { directorNav, directorSchoolSetupHref } from "@/components/layout/nav-config";
import { PrintSettingsPage } from "@/components/school-setup/PrintSettingsPage";

export default function DirectorPrintSettingsPage() {
  return (
    <PrintSettingsPage
      appTitle="Director"
      nav={directorNav}
      activeHref={directorSchoolSetupHref("print-settings")}
    />
  );
}
