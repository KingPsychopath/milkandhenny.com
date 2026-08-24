import { createFileRoute } from "@tanstack/react-router";
import { HotAndColdRoomRoute } from "@/features/things/hot-and-cold/HotAndColdRoomRoute";
import "@/features/things/hot-and-cold/hot-and-cold.css";
export const Route = createFileRoute("/things/hot-and-cold_/$roomId")({ component: Page });
function Page() {
  return <HotAndColdRoomRoute roomId={Route.useParams().roomId.toUpperCase()} />;
}
