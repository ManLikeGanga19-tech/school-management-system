import {
  principalNav,
  principalStudentsHref,
} from "@/components/layout/nav-config";
import { StudentProfilePage } from "@/components/students/StudentProfilePage";

type PrincipalStudentProfileRouteProps = {
  params: Promise<{
    enrollmentId: string;
  }>;
};

export default async function PrincipalStudentProfileRoute({
  params,
}: PrincipalStudentProfileRouteProps) {
  const { enrollmentId } = await params;
  return (
    <StudentProfilePage
      appTitle="Principal"
      nav={principalNav}
      activeHref={principalStudentsHref("all")}
      enrollmentId={enrollmentId}
      backHref={principalStudentsHref("all")}
    />
  );
}
