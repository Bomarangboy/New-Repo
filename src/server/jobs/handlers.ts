import type { JobHandler } from "./queue";
import { handleSendAcknowledgment } from "@/server/messaging/acknowledgment";
import { handleNotifyAckProblem, handleNotifyBooking, handleNotifyNewLead, handleNotifyReply } from "@/server/messaging/notifications";
import { handleSequenceStep } from "@/server/sequences/engine";
import { handleBookingMessage } from "@/server/booking/messages";
import { handleAdLeadRecord, handleAdLeadReconcile } from "@/server/ads/leads";
import { handleAdMetricsSync } from "@/server/ads/sync";

/** Every background job kind and the code that runs it. Handlers must be safe to run twice. */
export const HANDLERS: Record<string, JobHandler> = {
  send_acknowledgment: (job) => handleSendAcknowledgment(job),
  notify_new_lead: handleNotifyNewLead,
  notify_reply: handleNotifyReply,
  notify_ack_problem: handleNotifyAckProblem,
  notify_booking: handleNotifyBooking,
  sequence_step: (job) => handleSequenceStep(job),
  booking_message: (job) => handleBookingMessage(job),
  ad_lead_record: handleAdLeadRecord,
  ad_lead_reconcile: handleAdLeadReconcile,
  ad_metrics_sync: (job) => handleAdMetricsSync(job),
};
