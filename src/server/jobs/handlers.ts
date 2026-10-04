import type { JobHandler } from "./queue";
import { handleSendAcknowledgment } from "@/server/messaging/acknowledgment";
import { handleNotifyAckProblem, handleNotifyNewLead, handleNotifyReply } from "@/server/messaging/notifications";

/** Every background job kind and the code that runs it. Handlers must be safe to run twice. */
export const HANDLERS: Record<string, JobHandler> = {
  send_acknowledgment: (job) => handleSendAcknowledgment(job),
  notify_new_lead: handleNotifyNewLead,
  notify_reply: handleNotifyReply,
  notify_ack_problem: handleNotifyAckProblem,
};
