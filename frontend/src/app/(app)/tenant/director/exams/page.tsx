import { ExamsModulePage } from "@/components/exams/ExamsModulePage";
import { directorNav } from "@/components/layout/nav-config";

export default function DirectorExamsPage() {
  return <ExamsModulePage appTitle="Director" nav={directorNav} />;
}
