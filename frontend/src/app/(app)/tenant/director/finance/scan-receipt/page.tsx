import { ScanReceiptPage } from "@/components/finance/ScanReceiptPage";
import { directorNav, directorFinanceHref } from "@/components/layout/nav-config";

export default function DirectorScanReceiptPage() {
  return (
    <ScanReceiptPage
      appTitle="Director"
      nav={directorNav}
      activeHref={directorFinanceHref("scan-receipt")}
    />
  );
}
