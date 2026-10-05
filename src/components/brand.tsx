/**
 * The brand mark. By default the typography wordmark matching the approved logo ("Blue" in navy — white on dark
 * backgrounds — "water" in the brand color, "COLLECTIVE" letter-spaced beneath). Platform Studio can change the
 * words or replace it with an uploaded logo (validated raster image).
 */
export interface BrandProps { name: string; first: string; second: string; tagline: string; logoLight: string | null; logoDark: string | null }

export const DEFAULT_BRAND: BrandProps = { name: "Bluewater Collective", first: "Blue", second: "water", tagline: "COLLECTIVE", logoLight: null, logoDark: null };

export function Wordmark({ onDark = false, size = "md", brand = DEFAULT_BRAND }: { onDark?: boolean; size?: "sm" | "md" | "lg"; brand?: BrandProps }) {
  const logo = onDark ? brand.logoDark : brand.logoLight;
  if (logo) {
    const h = { sm: "h-7", md: "h-9", lg: "h-14" }[size];
    // eslint-disable-next-line @next/next/no-img-element -- small validated logo served by the app itself
    return <img src={logo} alt={brand.name} className={`${h} w-auto max-w-[14rem] object-contain`} />;
  }
  const main = { sm: "text-xl", md: "text-2xl", lg: "text-4xl" }[size];
  const sub = { sm: "text-[0.5rem] tracking-[0.42em]", md: "text-[0.6rem] tracking-[0.45em]", lg: "text-xs tracking-[0.5em]" }[size];
  return (
    <span className="inline-flex flex-col items-center leading-none select-none" aria-label={brand.name}>
      <span className={`${main} font-extrabold tracking-[-0.03em]`} aria-hidden>
        <span className={onDark ? "text-white" : "text-navy-900"}>{brand.first}</span>
        <span className="text-brand-500">{brand.second}</span>
      </span>
      {brand.tagline && (
        <span className={`${sub} mt-1 pl-[0.45em] font-medium ${onDark ? "text-white/90" : "text-navy-900"}`} aria-hidden>
          {brand.tagline}
        </span>
      )}
    </span>
  );
}
