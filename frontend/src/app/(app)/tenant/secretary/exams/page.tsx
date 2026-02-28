import { ExamsModulePage } from "@/components/exams/ExamsModulePage";
import { secretaryNav } from "@/components/layout/nav-config";

export default function SecretaryExamsPage() {
  return <ExamsModulePage appTitle="Secretary" nav={secretaryNav} />;
}
