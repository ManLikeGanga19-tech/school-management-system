import { PaymentSettingsPage } from "@/components/finance/PaymentSettingsPage";
import { directorNav } from "@/components/layout/nav-config";

export default function DirectorPaymentSettingsPage() {
  return (
    <PaymentSettingsPage
      role="director"
      nav={directorNav}
      activeHref="/tenant/director/finance/payment-settings"
    />
  );
}
