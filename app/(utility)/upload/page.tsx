import type { Metadata } from "next";
import { SITE_NAME } from "@/lib/config";
import { UploadDashboard } from "./UploadDashboard";

export const metadata: Metadata = {
  title: `upload · ${SITE_NAME}`,
  description: "Upload files to transfers or blog.",
  robots: { index: false, follow: false },
};

export default function UploadPage() {
  return (
    <main id="main" className="min-h-dvh">
      <UploadDashboard />
    </main>
  );
}
