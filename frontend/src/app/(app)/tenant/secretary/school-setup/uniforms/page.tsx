import { secretaryNav, secretarySchoolSetupHref } from "@/components/layout/nav-config";
import { UniformsSetupPage } from "@/components/school-setup/UniformsSetupPage";

export default function SecretaryUniformsSetupPage() {
  return (
    <UniformsSetupPage
      appTitle="Secretary"
      nav={secretaryNav}
      activeHref={secretarySchoolSetupHref("uniforms")}
    />
  );
}
