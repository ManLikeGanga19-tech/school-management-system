import { PaymentSettingsPage } from "@/components/finance/PaymentSettingsPage";
import { secretaryNav } from "@/components/layout/nav-config";

export default function SecretaryPaymentSettingsPage() {
  return (
    <PaymentSettingsPage
      role="secretary"
      nav={secretaryNav}
      activeHref="/tenant/secretary/finance/payment-settings"
    />
  );
}
