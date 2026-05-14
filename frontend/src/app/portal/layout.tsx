import { Suspense } from "react";

export const metadata = {
  title: "Parent Portal — ShuleHQ",
  description: "View your children's grades and fees.",
};

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <Suspense>{children}</Suspense>;
}
