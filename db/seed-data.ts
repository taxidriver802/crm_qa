/**
 * Deterministic QA fixture data.
 *
 * RULES FOR THIS FILE
 *   - no Math.random, no faker, no new Date() without a fixed argument
 *   - every timestamp derives from QA_SEED_ANCHOR via anchorPlusDays()
 *   - user UUIDs are hard-coded (the users table defaults to gen_random_uuid(),
 *     which would otherwise differ every run)
 *   - serial ids are captured from INSERT ... RETURNING into the seed manifest
 *     rather than assumed to be 1..n
 *
 * Status vocabularies below are taken from the application, not invented:
 *   leads  - src/components/forms/lead-form.js  STATUS_OPTIONS
 *   jobs   - src/components/forms/job-form.js   JOB_STATUS_OPTIONS
 *   tasks  - src/components/forms/task-form.js  STATUS_OPTIONS
 * and are additionally constrained by CHECK constraints in sql/schema.sql.
 */

import { anchorPlusDays } from "../config/constants.ts";

/** Fixed user ids so every foreign key is stable across runs. */
export const QA_OWNER_ID = "a0000000-0000-4000-8000-000000000001";
export const QA_AGENT_ID = "a0000000-0000-4000-8000-000000000002";

export const LEAD_STATUSES = ["New", "Contacted", "Qualified", "Closed", "Inactive"] as const;
export const JOB_STATUSES = [
  "New",
  "Contacted",
  "Appointment Scheduled",
  "Proposal Sent",
  "Closed Won",
  "Closed Lost",
] as const;

export interface SeedLead {
  key: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  source: string;
  status: string;
  budget_min: number | null;
  budget_max: number | null;
  notes: string | null;
  createdDayOffset: number;
}

/**
 * Six leads, one per pipeline status plus a second Qualified so the kanban has
 * a column with more than one card. `nakamura` is deliberately barren - no
 * jobs, tasks, files or notes - so empty states are reachable without
 * fabricating a special case later.
 */
export const LEADS: readonly SeedLead[] = Object.freeze([
  {
    key: "webb",
    first_name: "Marcus",
    last_name: "Webb",
    email: "marcus.webb@example.com",
    phone: "(612) 555-0147",
    source: "Referral",
    status: "New",
    budget_min: 12000,
    budget_max: 18000,
    notes: "Hail damage on the south slope. Wants an estimate before the end of the month.",
    createdDayOffset: 0,
  },
  {
    key: "raman",
    first_name: "Priya",
    last_name: "Raman",
    email: "priya.raman@example.com",
    phone: "(612) 555-0182",
    source: "Website",
    status: "Contacted",
    budget_min: 4000,
    budget_max: 6500,
    notes: "Gutters pulling away from the fascia along the back of the house.",
    createdDayOffset: 1,
  },
  {
    key: "whitfield",
    first_name: "Dana",
    last_name: "Whitfield",
    email: "dana.whitfield@example.com",
    phone: "(651) 555-0119",
    source: "Storm canvass",
    status: "Qualified",
    budget_min: 22000,
    budget_max: 30000,
    notes: "Insurance adjuster scheduled. Needs the inspection report for the claim.",
    createdDayOffset: 2,
  },
  {
    key: "castellanos",
    first_name: "Owen",
    last_name: "Castellanos",
    email: "owen.castellanos@example.com",
    phone: "(651) 555-0164",
    source: "Google Ads",
    status: "Qualified",
    budget_min: 15000,
    budget_max: 21000,
    notes: "Comparing three bids. Price sensitive but ready to move this quarter.",
    createdDayOffset: 3,
  },
  {
    key: "brooks",
    first_name: "Helen",
    last_name: "Brooks",
    email: "helen.brooks@example.com",
    phone: "(763) 555-0128",
    source: "Referral",
    status: "Closed",
    budget_min: 38000,
    budget_max: 45000,
    notes: "Tear-off complete and paid in full. Happy to act as a reference.",
    createdDayOffset: 4,
  },
  {
    key: "nakamura",
    first_name: "Theo",
    last_name: "Nakamura",
    email: "theo.nakamura@example.com",
    phone: "(763) 555-0193",
    source: "Trade show",
    status: "Inactive",
    budget_min: null,
    budget_max: null,
    notes: null,
    createdDayOffset: 5,
  },
]);

export interface SeedJob {
  key: string;
  leadKey: string;
  title: string;
  description: string;
  status: string;
  address: string;
  createdDayOffset: number;
}

export const JOBS: readonly SeedJob[] = Object.freeze([
  {
    key: "webb-reroof",
    leadKey: "webb",
    title: "Asphalt shingle replacement",
    description:
      "Full replacement of the south and west slopes. Architectural shingles, synthetic underlayment, new ice and water shield to code.",
    status: "Proposal Sent",
    address: "1420 Cedar Ridge Rd, Minneapolis, MN 55416",
    createdDayOffset: 6,
  },
  {
    key: "whitfield-inspection",
    leadKey: "whitfield",
    title: "Storm damage inspection",
    description:
      "Document hail impact across all elevations for the insurance claim. Photograph soft metals and test squares.",
    status: "Appointment Scheduled",
    address: "88 Larkspur Ln, Saint Paul, MN 55105",
    createdDayOffset: 7,
  },
  {
    key: "brooks-tearoff",
    leadKey: "brooks",
    title: "Full tear-off and re-deck",
    description:
      "Two-layer tear-off, replace deteriorated decking, install ridge vent and new flashing throughout.",
    status: "Closed Won",
    address: "7 Juniper Ct, Plymouth, MN 55447",
    createdDayOffset: 8,
  },
  {
    key: "raman-gutters",
    leadKey: "raman",
    title: "Gutter and fascia repair",
    description: "Replace 60 feet of gutter, repair rotted fascia board on the rear elevation.",
    status: "New",
    address: "305 Alder St, Minneapolis, MN 55408",
    createdDayOffset: 9,
  },
]);

export interface SeedTask {
  key: string;
  /** Exactly one of leadKey / jobKey - enforced by tasks_exactly_one_owner_check. */
  leadKey?: string;
  jobKey?: string;
  title: string;
  description: string | null;
  /** Days from the pinned QA_NOW, so overdue / today / upcoming are stable. */
  dueDayOffsetFromNow: number | null;
  status: string;
}

/**
 * Eight tasks spanning every state the tasks page and dashboard segment by:
 * overdue, due today, due within seven days, further out, undated, and
 * completed. Offsets are relative to the pinned clock (QA_NOW).
 */
export const TASKS: readonly SeedTask[] = Object.freeze([
  {
    key: "call-webb",
    leadKey: "webb",
    title: "Call Marcus Webb to confirm proposal walkthrough",
    description: "Confirm he received the emailed proposal and answer questions on the warranty.",
    dueDayOffsetFromNow: -5,
    status: "Pending",
  },
  {
    key: "order-shingles",
    jobKey: "webb-reroof",
    title: "Order shingles from ABC Supply",
    description: "Weathered Wood, 34 squares plus 10 percent waste.",
    dueDayOffsetFromNow: -3,
    status: "Pending",
  },
  {
    key: "adjuster-meeting",
    jobKey: "whitfield-inspection",
    title: "Meet insurance adjuster on site",
    description: "Bring the test-square photos and the measurement sheet.",
    dueDayOffsetFromNow: 0,
    status: "Pending",
  },
  {
    key: "send-inspection-report",
    jobKey: "whitfield-inspection",
    title: "Send inspection report to Dana Whitfield",
    description: null,
    dueDayOffsetFromNow: 2,
    status: "Pending",
  },
  {
    key: "follow-up-castellanos",
    leadKey: "castellanos",
    title: "Follow up with Owen Castellanos on bid comparison",
    description: "He is weighing two other bids. Reiterate the workmanship warranty.",
    dueDayOffsetFromNow: 4,
    status: "Pending",
  },
  {
    key: "schedule-gutter-crew",
    jobKey: "raman-gutters",
    title: "Schedule gutter crew",
    description: "Half-day job. Needs the 24-foot ladder.",
    dueDayOffsetFromNow: 6,
    status: "Pending",
  },
  {
    key: "warranty-packet",
    jobKey: "brooks-tearoff",
    title: "Mail warranty packet to Helen Brooks",
    description: "Include the manufacturer registration and the workmanship certificate.",
    dueDayOffsetFromNow: 17,
    status: "Pending",
  },
  {
    key: "final-walkthrough",
    jobKey: "brooks-tearoff",
    title: "Final walkthrough with homeowner",
    description: "Signed off. No punch list items.",
    dueDayOffsetFromNow: -7,
    status: "Completed",
  },
]);

export interface SeedEstimateLine {
  name: string;
  description: string | null;
  quantity: number;
  unit_price: number;
  source: string;
}

export interface SeedEstimate {
  key: string;
  jobKey: string;
  title: string;
  status: string;
  notes: string | null;
  taxRate: number;
  discount: number;
  createdDayOffset: number;
  respondedDayOffset?: number;
  responseNote?: string;
  lines: readonly SeedEstimateLine[];
}

export const ESTIMATES: readonly SeedEstimate[] = Object.freeze([
  {
    key: "webb-primary",
    jobKey: "webb-reroof",
    title: "Asphalt shingle replacement - south and west slopes",
    status: "Sent",
    notes: "Valid for 30 days. Price assumes one layer of tear-off.",
    taxRate: 0.07375,
    discount: 500,
    createdDayOffset: 10,
    lines: [
      {
        name: "Architectural shingles",
        description: "Weathered Wood, 30-year limited warranty",
        quantity: 34,
        unit_price: 128.5,
        source: "manual",
      },
      {
        name: "Synthetic underlayment",
        description: "10 square rolls",
        quantity: 4,
        unit_price: 92,
        source: "manual",
      },
      {
        name: "Ice and water shield",
        description: "Eaves and valleys",
        quantity: 6,
        unit_price: 118.75,
        source: "manual",
      },
      {
        name: "Tear-off and disposal",
        description: "Single layer, dumpster included",
        quantity: 1,
        unit_price: 2150,
        source: "manual",
      },
      {
        name: "Labor",
        description: "Crew of five, estimated three days",
        quantity: 1,
        unit_price: 4800,
        source: "manual",
      },
    ],
  },
  {
    key: "webb-alternate",
    jobKey: "webb-reroof",
    title: "Alternate - premium designer shingles",
    status: "Draft",
    notes: "Upgrade option presented alongside the primary proposal.",
    taxRate: 0.07375,
    discount: 0,
    createdDayOffset: 11,
    lines: [
      {
        name: "Designer shingles",
        description: "Slate profile, 50-year limited warranty",
        quantity: 34,
        unit_price: 214,
        source: "manual",
      },
      {
        name: "Labor",
        description: "Crew of five, estimated four days",
        quantity: 1,
        unit_price: 5600,
        source: "manual",
      },
    ],
  },
  {
    key: "brooks-final",
    jobKey: "brooks-tearoff",
    title: "Full tear-off, re-deck and ventilation",
    status: "Approved",
    notes: "Approved by homeowner. Converted to invoice.",
    taxRate: 0.07375,
    discount: 1200,
    createdDayOffset: 12,
    respondedDayOffset: 14,
    responseNote: "Looks good - please go ahead and book the crew.",
    lines: [
      {
        name: "Two-layer tear-off",
        description: null,
        quantity: 1,
        unit_price: 4300,
        source: "manual",
      },
      {
        name: "Replacement decking",
        description: "7/16 OSB, 22 sheets",
        quantity: 22,
        unit_price: 41.5,
        source: "manual",
      },
      {
        name: "Architectural shingles",
        description: "Charcoal, 42 squares",
        quantity: 42,
        unit_price: 128.5,
        source: "manual",
      },
      {
        name: "Ridge vent",
        description: "48 linear feet",
        quantity: 48,
        unit_price: 12.25,
        source: "manual",
      },
      {
        name: "Flashing package",
        description: "Step, counter and pipe boots",
        quantity: 1,
        unit_price: 875,
        source: "manual",
      },
      {
        name: "Labor",
        description: "Crew of six, estimated five days",
        quantity: 1,
        unit_price: 9200,
        source: "manual",
      },
    ],
  },
]);

export interface SeedInvoiceLine {
  name: string;
  description: string | null;
  quantity: number;
  unit_price: number;
}

export interface SeedInvoice {
  key: string;
  jobKey: string;
  estimateKey: string | null;
  invoice_number: string;
  status: string;
  notes: string | null;
  taxRate: number;
  discount: number;
  createdDayOffset: number;
  dueDayOffsetFromNow: number | null;
  paidDayOffsetFromNow?: number;
  lines: readonly SeedInvoiceLine[];
}

/** Three invoices so the list page renders Paid, Sent and Overdue together. */
export const INVOICES: readonly SeedInvoice[] = Object.freeze([
  {
    key: "brooks-paid",
    jobKey: "brooks-tearoff",
    estimateKey: "brooks-final",
    invoice_number: "INV-1001",
    status: "Paid",
    notes: "Paid by check. Thank you.",
    taxRate: 0.07375,
    discount: 1200,
    createdDayOffset: 15,
    dueDayOffsetFromNow: -12,
    paidDayOffsetFromNow: -14,
    lines: [
      { name: "Tear-off, re-deck and ventilation", description: "Per approved estimate", quantity: 1, unit_price: 22600 },
      { name: "Permit fee", description: null, quantity: 1, unit_price: 285 },
    ],
  },
  {
    key: "webb-sent",
    jobKey: "webb-reroof",
    estimateKey: null,
    invoice_number: "INV-1002",
    status: "Sent",
    notes: "Deposit invoice - 30 percent of contract value.",
    taxRate: 0.07375,
    discount: 0,
    createdDayOffset: 16,
    dueDayOffsetFromNow: 9,
    lines: [{ name: "Project deposit", description: "30 percent of contract", quantity: 1, unit_price: 3600 }],
  },
  {
    key: "whitfield-overdue",
    jobKey: "whitfield-inspection",
    estimateKey: null,
    invoice_number: "INV-1003",
    status: "Overdue",
    notes: "Second notice sent.",
    taxRate: 0.07375,
    discount: 0,
    createdDayOffset: 17,
    dueDayOffsetFromNow: -11,
    lines: [{ name: "Storm damage inspection and report", description: null, quantity: 1, unit_price: 450 }],
  },
]);

export interface SeedMeasurement {
  jobKey: string;
  label: string;
  value: number;
  unit: string;
}

export const MEASUREMENTS: readonly SeedMeasurement[] = Object.freeze([
  { jobKey: "webb-reroof", label: "Total roof area", value: 3400, unit: "sq ft" },
  { jobKey: "webb-reroof", label: "Predominant pitch", value: 6, unit: "/12" },
  { jobKey: "webb-reroof", label: "Ridge length", value: 52, unit: "ft" },
  { jobKey: "webb-reroof", label: "Valley length", value: 38, unit: "ft" },
  { jobKey: "brooks-tearoff", label: "Total roof area", value: 4200, unit: "sq ft" },
  { jobKey: "brooks-tearoff", label: "Decking replaced", value: 22, unit: "sheets" },
]);

export interface SeedNote {
  entityType: "lead" | "job";
  entityKey: string;
  body: string;
  createdDayOffset: number;
}

export const NOTES: readonly SeedNote[] = Object.freeze([
  {
    entityType: "lead",
    entityKey: "webb",
    body: "Left a voicemail and followed up by email. He prefers calls after 5pm on weekdays.",
    createdDayOffset: 18,
  },
  {
    entityType: "lead",
    entityKey: "castellanos",
    body: "Mentioned two competing bids, both around 17k. Emphasised our workmanship warranty.",
    createdDayOffset: 19,
  },
  {
    entityType: "job",
    entityKey: "webb-reroof",
    body: "Measured on site. Two layers on the garage but only one on the main house.",
    createdDayOffset: 20,
  },
  {
    entityType: "job",
    entityKey: "whitfield-inspection",
    body: "Adjuster confirmed for the 16th at 10am. Bring the drone for ridge photos.",
    createdDayOffset: 21,
  },
]);

export interface SeedActivity {
  jobKey: string;
  type: string;
  title: string;
  message: string | null;
  createdDayOffset: number;
}

export const ACTIVITY: readonly SeedActivity[] = Object.freeze([
  { jobKey: "webb-reroof", type: "JOB_CREATED", title: "Job created", message: "Created from lead Marcus Webb.", createdDayOffset: 6 },
  { jobKey: "webb-reroof", type: "ESTIMATE_CREATED", title: "Estimate created", message: "Asphalt shingle replacement - south and west slopes", createdDayOffset: 10 },
  { jobKey: "webb-reroof", type: "JOB_STATUS_CHANGED", title: "Status changed", message: "Contacted to Proposal Sent", createdDayOffset: 11 },
  { jobKey: "whitfield-inspection", type: "JOB_CREATED", title: "Job created", message: "Created from lead Dana Whitfield.", createdDayOffset: 7 },
  { jobKey: "brooks-tearoff", type: "ESTIMATE_STATUS_CHANGED", title: "Estimate approved", message: "Homeowner approved the tear-off estimate.", createdDayOffset: 14 },
  { jobKey: "brooks-tearoff", type: "JOB_STATUS_CHANGED", title: "Status changed", message: "Proposal Sent to Closed Won", createdDayOffset: 15 },
]);

export interface SeedFile {
  key: string;
  fixture: string;
  original_name: string;
  storage_key: string;
  mime_type: string;
  leadKey?: string;
  jobKey?: string;
  createdDayOffset: number;
}

/**
 * Storage keys are fixed (the app's own upload path uses Date.now() plus a
 * random suffix, which would not be reproducible). The binaries are copied
 * from fixtures/uploads into the backend's uploads directory at seed time so
 * previews and downloads resolve to real content.
 */
export const FILES: readonly SeedFile[] = Object.freeze([
  {
    key: "webb-roof-photo",
    fixture: "qa-fixture-roof-south.png",
    original_name: "south-slope-hail-damage.png",
    storage_key: "qa-fixture-roof-south.png",
    mime_type: "image/png",
    jobKey: "webb-reroof",
    createdDayOffset: 6,
  },
  {
    key: "webb-measurement-sheet",
    fixture: "qa-fixture-measurements.pdf",
    original_name: "measurement-sheet.pdf",
    storage_key: "qa-fixture-measurements.pdf",
    mime_type: "application/pdf",
    jobKey: "webb-reroof",
    createdDayOffset: 7,
  },
  {
    key: "whitfield-claim-photo",
    fixture: "qa-fixture-roof-ridge.png",
    original_name: "ridge-detail.png",
    storage_key: "qa-fixture-roof-ridge.png",
    mime_type: "image/png",
    jobKey: "whitfield-inspection",
    createdDayOffset: 8,
  },
  {
    key: "castellanos-bid",
    fixture: "qa-fixture-measurements.pdf",
    original_name: "competing-bid-notes.pdf",
    storage_key: "qa-fixture-competing-bid.pdf",
    mime_type: "application/pdf",
    leadKey: "castellanos",
    createdDayOffset: 9,
  },
]);

export interface SeedNotification {
  type: string;
  title: string;
  message: string;
  entityType: string | null;
  entityKey?: string;
  entityKind?: "lead" | "job" | "task" | "estimate" | "invoice";
  read: boolean;
  createdDayOffset: number;
}

/** Four unread notifications so the bell badge renders a non-zero count. */
export const NOTIFICATIONS: readonly SeedNotification[] = Object.freeze([
  {
    type: "TASK_OVERDUE",
    title: "Task overdue",
    message: "Call Marcus Webb to confirm proposal walkthrough is past its due date.",
    entityType: "task",
    entityKey: "call-webb",
    entityKind: "task",
    read: false,
    createdDayOffset: 22,
  },
  {
    type: "TASK_DUE_SOON",
    title: "Task due soon",
    message: "Meet insurance adjuster on site is due today.",
    entityType: "task",
    entityKey: "adjuster-meeting",
    entityKind: "task",
    read: false,
    createdDayOffset: 22,
  },
  {
    type: "ESTIMATE_CLIENT_RESPONDED",
    title: "Estimate approved",
    message: "Helen Brooks approved the tear-off estimate.",
    entityType: "estimate",
    entityKey: "brooks-final",
    entityKind: "estimate",
    read: false,
    createdDayOffset: 14,
  },
  {
    type: "INVOICE_PAID",
    title: "Invoice paid",
    message: "INV-1001 was marked paid.",
    entityType: "invoice",
    entityKey: "brooks-paid",
    entityKind: "invoice",
    read: false,
    createdDayOffset: 15,
  },
  {
    type: "INVOICE_CREATED",
    title: "Invoice created",
    message: "INV-1002 was created for the Webb re-roof deposit.",
    entityType: "invoice",
    entityKey: "webb-sent",
    entityKind: "invoice",
    read: true,
    createdDayOffset: 16,
  },
  {
    type: "FILE_UPLOADED",
    title: "File uploaded",
    message: "south-slope-hail-damage.png was added to the Webb re-roof.",
    entityType: "job",
    entityKey: "webb-reroof",
    entityKind: "job",
    read: true,
    createdDayOffset: 6,
  },
]);

export interface SeedSavedView {
  entity_type: "leads" | "jobs" | "tasks";
  name: string;
  filters: Record<string, unknown>;
}

export const SAVED_VIEWS: readonly SeedSavedView[] = Object.freeze([
  { entity_type: "leads", name: "Qualified pipeline", filters: { status: "Qualified" } },
  { entity_type: "tasks", name: "Overdue only", filters: { duePreset: "overdue" } },
]);

export interface SeedAutomationRule {
  name: string;
  description: string;
  trigger_event: string;
  conditions: Record<string, unknown>;
  action_type: string;
  action_config: Record<string, unknown>;
  enabled: boolean;
}

export const AUTOMATION_RULES: readonly SeedAutomationRule[] = Object.freeze([
  {
    name: "Kick off production when an estimate is approved",
    description: "Creates the standard production checklist as soon as a homeowner approves.",
    trigger_event: "ESTIMATE_APPROVED",
    conditions: {},
    action_type: "CREATE_TASKS",
    action_config: {
      tasks: [
        { title: "Order materials", offsetDays: 1 },
        { title: "Schedule crew", offsetDays: 2 },
        { title: "Pull permit", offsetDays: 3 },
      ],
    },
    enabled: true,
  },
]);

/** Convenience re-export so seed.ts has one import for time math. */
export { anchorPlusDays };
