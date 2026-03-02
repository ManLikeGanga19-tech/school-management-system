import { EventsModulePage } from "@/components/events/EventsModulePage";
import { principalEventsHref, principalNav } from "@/components/layout/nav-config";

export default function PrincipalEventsPage() {
  return (
    <EventsModulePage
      appTitle="Principal"
      nav={principalNav}
      activeHref={principalEventsHref()}
    />
  );
}
