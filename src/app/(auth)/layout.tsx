import { Wordmark } from "@/components/brand";
import { SimulationBanner } from "@/components/simulation-banner";
import { studioPlatform } from "@/server/studio/runtime";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const ui = await studioPlatform();
  const brand = ui.brand;
  return (
    <div className="flex min-h-dvh flex-col">
      <SimulationBanner />
      <div className="grid flex-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <aside className="relative hidden overflow-hidden bg-navy-900 p-12 text-white lg:flex lg:flex-col lg:justify-between">
          <div className="absolute -right-24 -top-24 size-96 rounded-full bg-brand-500/20 blur-3xl" aria-hidden />
          <div className="absolute -bottom-32 -left-16 size-96 rounded-full bg-brand-500/10 blur-3xl" aria-hidden />
          <div className="relative self-start"><Wordmark onDark size="lg" brand={brand} /></div>
          <div className="relative max-w-md">
            <p className="text-3xl font-bold leading-tight">{ui.t("login.headline")}</p>
            {ui.t("login.tagline") && <p className="mt-4 text-white/70">{ui.t("login.tagline")}</p>}
          </div>
          <p className="relative text-sm text-white/50">© {brand.name}</p>
        </aside>
        <main className="flex items-center justify-center px-4 py-10 sm:px-8">
          <div className="w-full max-w-md">
            <div className="mb-8 flex justify-center lg:hidden"><Wordmark size="lg" brand={brand} /></div>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
