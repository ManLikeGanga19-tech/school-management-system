import { directorNav, directorSchoolSetupHref } from "@/components/layout/nav-config";
import { UniformsSetupPage } from "@/components/school-setup/UniformsSetupPage";

export default function DirectorUniformsSetupPage() {
  return (
    <UniformsSetupPage
      appTitle="Director"
      nav={directorNav}
      activeHref={directorSchoolSetupHref("uniforms")}
    />
  );
}
