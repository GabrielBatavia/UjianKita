import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { DevPreviewClient } from "./dev-preview-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Dev UI Preview | UjianKita",
  robots: {
    index: false,
    follow: false,
  },
};

export default function DevPreviewPage() {
  if (process.env.NODE_ENV === "production" && process.env.ENABLE_DEV_PREVIEW !== "true") {
    notFound();
  }

  return <DevPreviewClient />;
}
