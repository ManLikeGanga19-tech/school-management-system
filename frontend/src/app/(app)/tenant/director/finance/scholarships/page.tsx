import { ScholarshipsPage } from "@/components/finance/ScholarshipsPage";
import { directorNav } from "@/components/layout/nav-config";

export default function DirectorScholarshipsPage() {
  return (
    <ScholarshipsPage
      role="director"
      nav={directorNav}
      activeHref="/tenant/director/finance/scholarships"
    />
  );
}
