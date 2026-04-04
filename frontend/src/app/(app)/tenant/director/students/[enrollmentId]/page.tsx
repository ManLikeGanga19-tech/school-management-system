import {
  directorNav,
  directorStudentsHref,
} from "@/components/layout/nav-config";
import { StudentProfilePage } from "@/components/students/StudentProfilePage";

type DirectorStudentProfileRouteProps = {
  params: Promise<{
    enrollmentId: string;
  }>;
};

export default async function DirectorStudentProfileRoute({
  params,
}: DirectorStudentProfileRouteProps) {
  const { enrollmentId } = await params;
  return (
    <StudentProfilePage
      appTitle="Director"
      nav={directorNav}
      activeHref={directorStudentsHref("all")}
      enrollmentId={enrollmentId}
      backHref={directorStudentsHref("all")}
      canHardDelete={true}
    />
  );
}
