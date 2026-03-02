import { EventsModulePage } from "@/components/events/EventsModulePage";
import { directorEventsHref, directorNav } from "@/components/layout/nav-config";

export default function DirectorEventsPage() {
  return <EventsModulePage appTitle="Director" nav={directorNav} activeHref={directorEventsHref()} />;
}
