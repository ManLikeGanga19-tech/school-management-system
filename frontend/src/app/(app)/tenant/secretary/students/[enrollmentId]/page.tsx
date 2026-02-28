import {
  secretaryNav,
  secretaryStudentsHref,
} from "@/components/layout/nav-config";
import { StudentProfilePage } from "@/components/students/StudentProfilePage";

type SecretaryStudentProfileRouteProps = {
  params: Promise<{
    enrollmentId: string;
  }>;
};

export default async function SecretaryStudentProfileRoute({
  params,
}: SecretaryStudentProfileRouteProps) {
  const { enrollmentId } = await params;
  return (
    <StudentProfilePage
      appTitle="Secretary"
      nav={secretaryNav}
      activeHref={secretaryStudentsHref("all")}
      enrollmentId={enrollmentId}
      backHref={secretaryStudentsHref("all")}
    />
  );
}
