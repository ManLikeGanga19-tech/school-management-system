import { FeeStructuresPage } from "@/components/finance/FeeStructuresPage";
import { secretaryNav } from "@/components/layout/nav-config";

export default function SecretaryFeeStructuresPage() {
  return (
    <FeeStructuresPage
      role="secretary"
      nav={secretaryNav}
      activeHref="/tenant/secretary/finance/fee-structures"
    />
  );
}
