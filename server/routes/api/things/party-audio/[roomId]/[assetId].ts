import { defineHandler, getRouterParam } from "nitro/h3";
import { useStorage } from "nitro/storage";
import { getPartyAudioAsset } from "@/features/things/spelling-party/party-room.server";

export default defineHandler(async (event) => {
  const roomId = getRouterParam(event, "roomId") ?? "";
  const assetId = getRouterParam(event, "assetId") ?? "";
  const key = await getPartyAudioAsset(roomId, assetId);
  if (!key) return new Response("Not found", { status: 404 });
  const bytes = await useStorage("assets:party-audio").getItemRaw<Uint8Array>(key);
  if (!bytes) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(bytes).buffer, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" } });
});
