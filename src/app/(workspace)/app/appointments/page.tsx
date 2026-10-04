import { CalendarDays } from "lucide-react";
import { ComingSoon } from "@/components/coming-soon";
import { pageContext } from "@/lib/authz/guard";

export const metadata = { title: "Appointments" };

export default async function Page() {
  await pageContext("appointment.view", "appointments");
  return <ComingSoon title="Appointments" subtitle="Bookings from your scheduling tool." icon={CalendarDays} what="Booked, rescheduled and cancelled appointments will appear here once your scheduling tool is connected." />;
}
