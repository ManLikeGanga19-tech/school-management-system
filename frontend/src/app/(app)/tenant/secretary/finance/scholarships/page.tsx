import { ScholarshipsPage } from "@/components/finance/ScholarshipsPage";
import { secretaryNav } from "@/components/layout/nav-config";

export default function SecretaryScholarshipsPage() {
  return (
    <ScholarshipsPage
      role="secretary"
      nav={secretaryNav}
      activeHref="/tenant/secretary/finance/scholarships"
    />
  );
}
