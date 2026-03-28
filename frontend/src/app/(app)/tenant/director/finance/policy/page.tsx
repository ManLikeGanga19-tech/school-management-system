import { PolicyPage } from "@/components/finance/PolicyPage";
import { directorNav } from "@/components/layout/nav-config";

export default function DirectorFinancePolicyPage() {
  return (
    <PolicyPage
      nav={directorNav}
      activeHref="/tenant/director/finance/policy"
    />
  );
}
