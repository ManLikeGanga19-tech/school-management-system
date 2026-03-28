import { EnterMarksPage } from "@/components/exams/EnterMarksPage";
import { directorNav, directorExamsHref } from "@/components/layout/nav-config";

export default function DirectorEnterMarksPage() {
  return (
    <EnterMarksPage
      appTitle="Director"
      nav={directorNav}
      activeHref={directorExamsHref("enter-marks")}
    />
  );
}
