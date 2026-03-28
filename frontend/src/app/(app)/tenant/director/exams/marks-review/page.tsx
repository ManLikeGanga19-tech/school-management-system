import { MarksReviewPage } from "@/components/exams/MarksReviewPage";
import { directorNav, directorExamsHref } from "@/components/layout/nav-config";

export default function DirectorMarksReviewPage() {
  return (
    <MarksReviewPage
      appTitle="Director"
      nav={directorNav}
      activeHref={directorExamsHref("marks-review")}
    />
  );
}
