import { FORMAT, type Definition } from "./format";

/**
 * Bluewater's starter library: written by Bluewater as reasonable starting points. They are UNVERIFIED (no
 * performance evidence yet) and are loaded as drafts for an administrator to review and publish.
 * docs/examples/library-sequence-example.json is a copy of the second one, to show the import format.
 */
export const STARTER_LIBRARY: Definition[] = [
  {
    format: FORMAT, kind: "acknowledgment", name: "Friendly instant thank-you",
    description: "A short, warm reply the moment a lead arrives, by text (with permission) and email. Sets the expectation that a person will follow up.",
    industry: "Any business", objective: "Respond instantly", category: "Instant replies", requiredPackage: "instant_response", requiredIntegrations: [],
    acknowledgment: {
      smsBody: "Hi {{first_name|there}}, thanks for reaching out to {{company_name}}! We got your request about {{service|your project}} and will get back to you shortly. Reply STOP to opt out.",
      emailSubject: "Thanks for contacting {{company_name}}",
      emailBody: "Hi {{first_name|there}},\n\nThanks for reaching out to {{company_name}}. We received your request about {{service|your project}} and someone from our team will be in touch shortly.\n\nIf there's anything else we should know, just reply to this email.\n\n{{company_name}}",
    },
  },
  {
    format: FORMAT, kind: "sequence", name: "Home services: estimate follow-up (3 steps)",
    description: "Three gentle follow-ups over a week for home-service leads who haven't booked an estimate yet: a next-day nudge, a reminder with your offer, and a last check-in.",
    industry: "Home services", objective: "Book an estimate", category: "Follow-up", requiredPackage: "follow_up_booking", requiredIntegrations: ["booking"],
    entry: "new_website_leads", stopOnManualMessage: true, handoffTask: true,
    steps: [
      { delayMinutes: 1440, channel: "sms_or_email",
        smsBody: "Hi {{first_name|there}}, it's {{company_name}} following up on your {{service|request}}. Pick a time for your estimate here: {{booking_link|just reply and we'll set one up}}. Reply STOP to opt out.",
        emailSubject: "Your estimate with {{company_name}}",
        emailBody: "Hi {{first_name|there}},\n\nFollowing up on your request about {{service|your project}}. You can pick a time for your estimate here: {{booking_link|reply to this email and we'll find a time}}\n\n{{company_name}}" },
      { delayMinutes: 2880, channel: "sms_or_email",
        smsBody: "Hi {{first_name|there}}, {{company_name}} here. [[your current offer, e.g. Free estimates this month]]. Want to grab a time? {{booking_link|Reply here.}} Reply STOP to opt out.",
        emailSubject: "Still thinking about {{service|your project}}?",
        emailBody: "Hi {{first_name|there}},\n\n[[your current offer, e.g. Free estimates this month]]. If you'd still like help with {{service|your project}}, book a time that suits you: {{booking_link|just reply to this email}}\n\n{{company_name}}" },
      { delayMinutes: 5760, channel: "sms_or_email",
        smsBody: "Hi {{first_name|there}}, last note from {{company_name}} about your {{service|request}}. If you still need help, just reply and we'll take it from there. Reply STOP to opt out.",
        emailSubject: "Last note from {{company_name}}",
        emailBody: "Hi {{first_name|there}},\n\nThis is our last follow-up about {{service|your project}}. If you'd still like help, reply to this email and we'll take it from there.\n\n{{company_name}}" },
    ],
  },
  {
    format: FORMAT, kind: "sequence", name: "New patient follow-up (2 steps)",
    description: "For dental, health and wellness practices: two polite follow-ups inviting a new patient to book a first visit, with no medical details in the messages.",
    industry: "Health & wellness", objective: "Book a first visit", category: "Follow-up", requiredPackage: "follow_up_booking", requiredIntegrations: [],
    entry: "new_website_leads", stopOnManualMessage: true, handoffTask: true,
    steps: [
      { delayMinutes: 1440, channel: "sms_or_email",
        smsBody: "Hi {{first_name|there}}, this is {{company_name}}. We'd love to welcome you for a first visit. Book here: {{booking_link|reply and we'll find a time}}. Reply STOP to opt out.",
        emailSubject: "Welcome to {{company_name}}",
        emailBody: "Hi {{first_name|there}},\n\nThanks for your interest in {{company_name}}. We'd love to see you for a first visit — you can choose a time here: {{booking_link|reply to this email and we'll find a time}}\n\n{{company_name}}" },
      { delayMinutes: 4320, channel: "sms_or_email",
        smsBody: "Hi {{first_name|there}}, {{company_name}} again. Any questions before booking your first visit? Just reply here. Reply STOP to opt out.",
        emailSubject: "Any questions? — {{company_name}}",
        emailBody: "Hi {{first_name|there}},\n\nIf you have any questions before booking your first visit, just reply to this email — we're happy to help.\n\n{{company_name}}" },
    ],
  },
  {
    format: FORMAT, kind: "sequence", name: "Quote follow-up by email (3 steps)",
    description: "Email-only follow-up for businesses that send quotes: checks the quote arrived, answers questions, and closes the loop after two weeks.",
    industry: "Contractors & trades", objective: "Win the quote", category: "Follow-up", requiredPackage: "follow_up_booking", requiredIntegrations: [],
    entry: "manual_only", stopOnManualMessage: true, handoffTask: true,
    steps: [
      { delayMinutes: 2880, channel: "email", emailSubject: "Your quote from {{company_name}}",
        emailBody: "Hi {{first_name|there}},\n\nJust checking that our quote for {{service|your project}} reached you. Happy to walk through any part of it — reply to this email.\n\n{{company_name}}" },
      { delayMinutes: 5760, channel: "email", emailSubject: "Questions about your {{service|project}}?",
        emailBody: "Hi {{first_name|there}},\n\nMost customers have a question or two before deciding. If anything in the quote is unclear, reply and we'll explain.\n\n{{company_name}}" },
      { delayMinutes: 10080, channel: "email", emailSubject: "Closing the loop — {{company_name}}",
        emailBody: "Hi {{first_name|there}},\n\nWe haven't heard back, so we'll close this request for now. If you'd still like to go ahead with {{service|your project}}, just reply any time.\n\n{{company_name}}" },
    ],
  },
  {
    format: FORMAT, kind: "sequence", name: "Quick 2-step check-in",
    description: "A light-touch follow-up for any business: one next-day check-in and one final note three days later.",
    industry: "Any business", objective: "Start a conversation", category: "Follow-up", requiredPackage: "follow_up_booking", requiredIntegrations: [],
    entry: "new_website_leads", stopOnManualMessage: true, handoffTask: true,
    steps: [
      { delayMinutes: 1440, channel: "sms_or_email",
        smsBody: "Hi {{first_name|there}}, it's {{company_name}}. Just checking in about your {{service|request}} — any questions? Reply STOP to opt out.",
        emailSubject: "Checking in — {{company_name}}",
        emailBody: "Hi {{first_name|there}},\n\nJust checking in about {{service|your request}}. Any questions? Reply to this email and we'll help.\n\n{{company_name}}" },
      { delayMinutes: 4320, channel: "sms_or_email",
        smsBody: "Hi {{first_name|there}}, {{company_name}} here — if you still need help with {{service|your request}}, just reply. Reply STOP to opt out.",
        emailSubject: "Still need help? — {{company_name}}",
        emailBody: "Hi {{first_name|there}},\n\nIf you still need help with {{service|your request}}, just reply to this email.\n\n{{company_name}}" },
    ],
  },
];
