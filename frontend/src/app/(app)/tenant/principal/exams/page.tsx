import { ExamsModulePage } from "@/components/exams/ExamsModulePage";
import { principalNav } from "@/components/layout/nav-config";

export default function PrincipalExamsPage() {
  return <ExamsModulePage appTitle="Principal" nav={principalNav} />;
}
