import { CategoriesPage } from "@/components/finance/CategoriesPage";
import { secretaryNav } from "@/components/layout/nav-config";

export default function SecretaryCategoriesPage() {
  return (
    <CategoriesPage
      role="secretary"
      nav={secretaryNav}
      activeHref="/tenant/secretary/finance/categories"
    />
  );
}
