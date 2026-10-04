import { env } from "@/lib/env";

/**
 * Always-visible notice on any environment that cannot reach real customers.
 * The demo label is required by the sales-demo specification.
 */
export function SimulationBanner() {
  const e = env().APP_ENV;
  if (e === "production") return null;
  const text =
    e === "demo" ? "Demo — Sample Data. Messages, ad accounts, CRM and bookings are simulated."
    : e === "staging" ? "Staging — test environment. Not for real customer data."
    : "Development — local test environment. No real messages are sent.";
  return (
    <div role="note" className={`px-4 py-1.5 text-center text-xs font-semibold ${e === "demo" ? "bg-amber-300 text-amber-950" : "bg-navy-950 text-amber-200"}`}>
      {text}
    </div>
  );
}
