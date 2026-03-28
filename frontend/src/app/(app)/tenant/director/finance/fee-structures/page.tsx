import { FeeStructuresPage } from "@/components/finance/FeeStructuresPage";
import { directorNav } from "@/components/layout/nav-config";

export default function DirectorFeeStructuresPage() {
  return (
    <FeeStructuresPage
      role="director"
      nav={directorNav}
      activeHref="/tenant/director/finance/fee-structures"
    />
  );
}
