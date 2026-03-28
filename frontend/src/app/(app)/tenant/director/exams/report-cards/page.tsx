import { ReportCardsPage } from "@/components/exams/ReportCardsPage";
import { directorNav, directorExamsHref } from "@/components/layout/nav-config";

export default function DirectorReportCardsPage() {
  return (
    <ReportCardsPage
      appTitle="Director"
      nav={directorNav}
      activeHref={directorExamsHref("report-cards")}
      role="director"
    />
  );
}
