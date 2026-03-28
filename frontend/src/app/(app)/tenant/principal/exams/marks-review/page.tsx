import { MarksReviewPage } from "@/components/exams/MarksReviewPage";
import { principalNav, principalExamsHref } from "@/components/layout/nav-config";

export default function PrincipalMarksReviewPage() {
  return (
    <MarksReviewPage
      appTitle="Principal"
      nav={principalNav}
      activeHref={principalExamsHref("marks-review")}
    />
  );
}
