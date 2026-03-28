import { EnterMarksPage } from "@/components/exams/EnterMarksPage";
import { secretaryNav, secretaryExamsHref } from "@/components/layout/nav-config";

export default function SecretaryEnterMarksPage() {
  return (
    <EnterMarksPage
      appTitle="Secretary"
      nav={secretaryNav}
      activeHref={secretaryExamsHref("enter-marks")}
    />
  );
}
