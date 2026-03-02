import { EventsModulePage } from "@/components/events/EventsModulePage";
import { secretaryEventsHref, secretaryNav } from "@/components/layout/nav-config";

export default function SecretaryEventsPage() {
  return <EventsModulePage appTitle="Secretary" nav={secretaryNav} activeHref={secretaryEventsHref()} />;
}
