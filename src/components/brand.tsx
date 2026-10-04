/**
 * Typography-based wordmark, matching the approved logo:
 * "Blue" in navy (white on dark backgrounds), "water" in vivid blue,
 * "COLLECTIVE" letter-spaced beneath.
 */
export function Wordmark({ onDark = false, size = "md" }: { onDark?: boolean; size?: "sm" | "md" | "lg" }) {
  const main = { sm: "text-xl", md: "text-2xl", lg: "text-4xl" }[size];
  const sub = { sm: "text-[0.5rem] tracking-[0.42em]", md: "text-[0.6rem] tracking-[0.45em]", lg: "text-xs tracking-[0.5em]" }[size];
  return (
    <span className="inline-flex flex-col items-center leading-none select-none" aria-label="Bluewater Collective">
      <span className={`${main} font-extrabold tracking-[-0.03em]`} aria-hidden>
        <span className={onDark ? "text-white" : "text-navy-900"}>Blue</span>
        <span className="text-brand-500">water</span>
      </span>
      <span className={`${sub} mt-1 pl-[0.45em] font-medium ${onDark ? "text-white/90" : "text-navy-900"}`} aria-hidden>
        COLLECTIVE
      </span>
    </span>
  );
}
