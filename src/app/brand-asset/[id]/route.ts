import { eq } from "drizzle-orm";
import { withSystemDb } from "@/lib/db/context";
import { studioAssets } from "@/lib/db/schema";

/**
 * Serves Studio images (logos, favicon). Public because the sign-in page shows them. Only validated raster
 * images exist in this table; the response forbids scripts and content sniffing as a second line of defence.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return new Response("Not found", { status: 404 });
  const [a] = await withSystemDb("studio: serve image", (tx) => tx.select({ mime: studioAssets.mime, bytes: studioAssets.bytes, sha256: studioAssets.sha256 }).from(studioAssets).where(eq(studioAssets.id, id)));
  if (!a) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(a.bytes), {
    headers: {
      "Content-Type": a.mime,
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=31536000, immutable",
      ETag: `"${a.sha256}"`,
    },
  });
}
