import type { Metadata, Viewport } from "next";
import "@fontsource-variable/figtree";
import "./globals.css";
import { studioPlatform } from "@/server/studio/runtime";

export async function generateMetadata(): Promise<Metadata> {
  const ui = await studioPlatform();
  const b = ui.brand;
  return {
    title: { default: b.name, template: `%s · ${b.name}` },
    description: "Respond to every lead, follow up automatically and see what your advertising produces.",
    robots: { index: false, follow: false },
    ...(b.favicon ? { icons: { icon: b.favicon } } : {}),
  };
}

/** Branding is read per request so a Studio publication applies everywhere at once (no stale prebuilt pages). */
export const dynamic = "force-dynamic";

export const viewport: Viewport = { themeColor: "#0f243d", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const ui = await studioPlatform();
  return (
    <html lang="en">
      <head>
        {/* Platform Studio colors and font (validated values only; see src/server/studio/registry.ts). */}
        <style id="studio-platform" dangerouslySetInnerHTML={{ __html: ui.css(":root") }} />
      </head>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
