import type { Metadata } from "next";
import { SITE_NAME } from "@/lib/shared/config";
import { AdminDashboard } from "./AdminDashboard";

export const metadata: Metadata = {
  title: `admin · ${SITE_NAME}`,
  description: "Admin dashboard for guestlist, votes, and upload tooling.",
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return (
    <main id="main" className="min-h-dvh">
      <AdminDashboard />
    </main>
  );
}
