import {
  directorNav,
  directorStudentsHref,
} from "@/components/layout/nav-config";
import { AllStudentsPage } from "@/components/students/AllStudentsPage";

export default function DirectorAllStudentsPage() {
  return (
    <AllStudentsPage
      appTitle="Director"
      nav={directorNav}
      activeHref={directorStudentsHref("all")}
      profileBasePath="/tenant/director/students"
    />
  );
}
