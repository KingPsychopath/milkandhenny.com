import { getBestDressedSnapshot } from "@/features/best-dressed/server";
import { BestDressedClient } from "./BestDressedClient";

export default async function BestDressedPage() {
  const snapshot = await getBestDressedSnapshot();
  return <BestDressedClient initialSnapshot={snapshot} />;
}

