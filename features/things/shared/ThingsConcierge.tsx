import { PixelWorld } from "./PixelWorld";

export function ThingsConcierge() {
  return (
    <aside className="things-concierge" aria-label="The games concierge is arranging the room">
      <PixelWorld
        className="things-concierge-scene"
        room={{
          game: "hotel",
          roomId: "things-concierge",
          status: "waiting",
          capacity: 1,
          players: [
            {
              id: "things-concierge",
              name: "concierge",
              ready: false,
              lead: true,
              role: "concierge",
            },
          ],
        }}
        label="A small games concierge walks through the room"
      />
      <p aria-hidden="true">ask me where the good games are</p>
    </aside>
  );
}
