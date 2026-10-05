import { Wordmark } from "@/components/brand";
import { studioPlatform } from "@/server/studio/runtime";
import { confirmUnsubscribe, describeUnsubscribe } from "@/server/messaging/unsubscribe";

export const metadata = { title: "Unsubscribe", robots: { index: false } };
export const dynamic = "force-dynamic";

async function unsubscribe(fd: FormData) {
  "use server";
  await confirmUnsubscribe(String(fd.get("token") ?? ""));
  const { redirect } = await import("next/navigation");
  redirect(`/u/${String(fd.get("token"))}?done=1`);
}

/** Public page. A button (not the link itself) confirms, so email security scanners can't unsubscribe people. */
export default async function UnsubscribePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ done?: string }> }) {
  const brand = (await studioPlatform()).brand;
  const { token } = await params;
  const { done } = await searchParams;
  const info = await describeUnsubscribe(token);
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <div className="card w-full max-w-md p-8">
        {!info ? (
          <p className="text-sm text-muted">This link isn&apos;t valid. If you keep receiving unwanted emails, reply to one and ask to be removed.</p>
        ) : done ? (
          <><h1 className="text-xl font-bold">You&apos;re unsubscribed</h1><p className="mt-2 text-sm text-muted">{info.companyName} won&apos;t email {info.email} through this service again.</p></>
        ) : (
          <form action={unsubscribe}>
            <h1 className="text-xl font-bold">Stop emails from {info.companyName}?</h1>
            <p className="mt-2 text-sm text-muted">{info.email} will no longer receive emails from {info.companyName} sent through this service.</p>
            <input type="hidden" name="token" value={token} />
            <button className="btn-primary mt-6 w-full">Unsubscribe</button>
          </form>
        )}
      </div>
      <p className="mt-6 text-xs text-muted">Sent on behalf of the business using</p>
      <div className="mt-1 scale-75"><Wordmark size="sm" brand={brand} /></div>
    </main>
  );
}
