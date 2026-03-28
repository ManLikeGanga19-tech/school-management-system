import { CategoriesPage } from "@/components/finance/CategoriesPage";
import { directorNav } from "@/components/layout/nav-config";

export default function DirectorCategoriesPage() {
  return (
    <CategoriesPage
      role="director"
      nav={directorNav}
      activeHref="/tenant/director/finance/categories"
    />
  );
}
