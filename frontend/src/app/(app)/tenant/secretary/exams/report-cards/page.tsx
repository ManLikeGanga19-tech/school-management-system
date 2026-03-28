import { ReportCardsPage } from "@/components/exams/ReportCardsPage";
import { secretaryNav, secretaryExamsHref } from "@/components/layout/nav-config";

export default function SecretaryReportCardsPage() {
  return (
    <ReportCardsPage
      appTitle="Secretary"
      nav={secretaryNav}
      activeHref={secretaryExamsHref("report-cards")}
      role="secretary"
    />
  );
}
