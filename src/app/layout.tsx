import type { Metadata, Viewport } from "next";
import "@fontsource-variable/figtree";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Bluewater Collective", template: "%s · Bluewater Collective" },
  description: "Respond to every lead, follow up automatically and see what your advertising produces.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#0f243d", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
