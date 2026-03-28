import { MarksReviewPage } from "@/components/exams/MarksReviewPage";
import { secretaryNav, secretaryExamsHref } from "@/components/layout/nav-config";

export default function SecretaryMarksReviewPage() {
  return (
    <MarksReviewPage
      appTitle="Secretary"
      nav={secretaryNav}
      activeHref={secretaryExamsHref("marks-review")}
    />
  );
}
