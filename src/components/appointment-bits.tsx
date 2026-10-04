import { FlaskConical } from "lucide-react";
import { Badge } from "./ui";
import { SOURCE_NAMES } from "@/server/booking/appointments";

/** Where an appointment came from. Simulated ones are always labeled as such. */
export function SourceBadge({ source }: { source: string }) {
  return source === "simulated"
    ? <Badge tone="amber"><FlaskConical className="size-3" /> Simulated</Badge>
    : <Badge tone={source === "calcom" ? "purple" : "neutral"}>{SOURCE_NAMES[source] ?? source}</Badge>;
}
