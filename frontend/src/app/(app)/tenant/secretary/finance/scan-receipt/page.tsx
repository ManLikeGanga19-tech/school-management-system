import { ScanReceiptPage } from "@/components/finance/ScanReceiptPage";
import { secretaryNav, secretaryFinanceHref } from "@/components/layout/nav-config";

export default function SecretaryScanReceiptPage() {
  return (
    <ScanReceiptPage
      appTitle="Secretary"
      nav={secretaryNav}
      activeHref={secretaryFinanceHref("scan-receipt")}
    />
  );
}
