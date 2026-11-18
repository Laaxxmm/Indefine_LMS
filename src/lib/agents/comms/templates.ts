// Deterministic templates for client message drafts (Phase 10). Code writes every message from a
// fixed skeleton and fills every fact: client name, period, dates as DD MMM YYYY (IST), amounts in
// ₹ with Indian grouping, the ack ref the human recorded, the document list. The model may later
// polish the wording of `paragraphs` and `subject` (drafting.ts); the greeting, the document
// list and the sign-off never go through the model. Plain words, one ask, no emoji. Pure.
import type { FirmService, JobTaskState } from "@prisma/client";
import { formatDate, formatInr } from "@/lib/agents/core/format";
import { normalizeFacts, tokenFacts, type Fact } from "./facts";
import { countAsks, sentences } from "./tone";
import { LIMITS, type CommsKind, type ReminderAsk } from "./types";

/** The job a message is about, as stored on its JobTask. */
export type JobFacts = {
  service: FirmService;
  title: string;
  period: string;
  fy: string;
  state: JobTaskState;
  statutoryDueOn: Date | null;
  filedAt: Date | null;
  ackRef: string | null;
};

type Common = {
  clientName: string;
  contactName?: string | null;
  senderName: string;
  firmName: string;
};

export type TemplateInput = Common &
  (
    | { kind: "status"; job: JobFacts }
    | { kind: "doc-chase"; job: JobFacts; items: string[]; replyBy: Date }
    | { kind: "due-reminder"; job: JobFacts; ask: ReminderAsk; replyBy: Date; amountInr?: number | null }
    | { kind: "filing-completed"; job: JobFacts; amountInr?: number | null }
    | { kind: "query-response"; topic: string; answer: string; job?: JobFacts | null }
  );

export type Template = {
  kind: CommsKind;
  subject: string;
  greeting: string;
  /** The prose the model may polish, one entry per paragraph (≤ LIMITS.paragraphChars each). */
  paragraphs: string[];
  /** Fixed list (doc-chase documents), printed after paragraph `itemsAfter`. */
  items: string[];
  itemsAfter: number;
  closing: string;
  signature: string[];
  /** Every value the message must carry exactly as written here. */
  facts: Fact[];
  /** The message carries exactly one ask (doc-chase, reminder) — the tone lint then requires it. */
  requiresAsk: boolean;
};

/** A request the template cannot be built from: `status` 400 (bad input) or 409 (a fact is not recorded yet). */
export class CommsInputError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 409 = 400,
  ) {
    super(message);
    this.name = "CommsInputError";
  }
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-10" → "October 2026"; "Q2" → "Q2 of FY 2026-27"; "Annual" → "FY 2026-27". */
export function periodLabel(period: string, fy: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return `${MONTH_NAMES[Number(m[2]) - 1]} ${m[1]}`;
  const q = /^Q([1-4])$/.exec(period);
  if (q) return `Q${q[1]} of FY ${fy}`;
  if (period === "Annual") return `FY ${fy}`;
  return `${period} (FY ${fy})`;
}

/** Where the job stands, in words a client understands (no internal states, no mention of agents). */
export function stageSentence(job: JobFacts): string {
  switch (job.state) {
    case "DRAFT":
    case "ASSIGNED":
      return "We have scheduled this work and have not started it yet.";
    case "IN_PREP":
    case "AGENT_DONE":
      return "We are preparing it now.";
    case "IN_REVIEW":
      return "It is prepared and our team is reviewing it.";
    case "APPROVED":
      return "It has been reviewed and is ready to file.";
    default:
      return job.filedAt ? `It was filed on ${formatDate(job.filedAt)}.` : "It has been filed.";
  }
}

const isFiled = (s: JobTaskState) => s === "FILED_BY_HUMAN" || s === "CLOSING" || s === "DONE";

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

function cleanText(label: string, raw: string, max: number): string {
  const v = oneLine(String(raw ?? ""));
  if (!v) throw new CommsInputError(`${label} is required`);
  if (v.length > max) throw new CommsInputError(`${label} is longer than ${max} characters`);
  return v;
}

/** Staff answer → paragraphs of at most LIMITS.paragraphChars, split at blank lines, then at sentences. */
export function answerParagraphs(answer: string): string[] {
  const raw = String(answer ?? "").trim();
  if (!raw) throw new CommsInputError("The answer is required");
  if (raw.replace(/\s+/g, " ").length > LIMITS.answerChars) throw new CommsInputError(`The answer is longer than ${LIMITS.answerChars} characters; keep it short or send two messages`);
  const out: string[] = [];
  for (const block of raw.split(/\n\s*\n/).map(oneLine).filter(Boolean)) {
    let cur = "";
    for (const s of sentences(block)) {
      if (s.length > LIMITS.paragraphChars) throw new CommsInputError(`A sentence in the answer is longer than ${LIMITS.paragraphChars} characters; shorten it`);
      if (cur && cur.length + 1 + s.length > LIMITS.paragraphChars) {
        out.push(cur);
        cur = s;
      } else cur = cur ? `${cur} ${s}` : s;
    }
    if (cur) out.push(cur);
  }
  if (out.length > 3) throw new CommsInputError("The answer has more than 3 paragraphs; keep it short or send two messages");
  return out;
}

function inr(n: number | null | undefined, label: string): string | null {
  if (n === null || n === undefined) return null;
  if (!Number.isFinite(n) || n <= 0 || n > 1e12) throw new CommsInputError(`${label} must be an amount above ₹0`);
  return formatInr(n, { symbol: true });
}

function requireDue(job: JobFacts): string {
  if (!job.statutoryDueOn) throw new CommsInputError("This job has no statutory due date recorded", 409);
  return formatDate(job.statutoryDueOn);
}

/** Build the deterministic message. Throws CommsInputError for input it cannot honestly fill. */
export function buildTemplate(input: TemplateInput): Template {
  const clientName = cleanText("Client name", input.clientName, 120);
  const contact = input.contactName ? oneLine(input.contactName) : "";
  const greeting = contact ? `Dear ${contact},` : "Dear Sir or Madam,";
  const signature = [oneLine(input.senderName) || "Indefine team", oneLine(input.firmName)].filter(Boolean);
  const facts: Fact[] = [{ kind: "name", value: clientName }];
  if (contact) facts.push({ kind: "name", value: contact });
  const base = { greeting, closing: "Regards,", signature, items: [] as string[], itemsAfter: 0 };

  const jobBits = (job: JobFacts) => {
    const title = cleanText("Job title", job.title, 80);
    const period = periodLabel(job.period, job.fy);
    facts.push({ kind: "label", value: title }, { kind: "period", value: period });
    return { title, period, what: `${title} for ${period}` };
  };
  const date = (d: Date) => {
    const v = formatDate(d);
    facts.push({ kind: "date", value: v });
    return v;
  };

  switch (input.kind) {
    case "status": {
      const { what } = jobBits(input.job);
      const paragraphs = [`This is an update on your ${what}.`, stageSentence(input.job)];
      if (input.job.filedAt && isFiled(input.job.state)) date(input.job.filedAt);
      if (input.job.statutoryDueOn && !isFiled(input.job.state)) paragraphs.push(`The due date for filing is ${date(input.job.statutoryDueOn)}.`);
      return { ...base, kind: "status", subject: `${what} (${clientName}): status update`, paragraphs, facts: normalizeFacts(facts), requiresAsk: false };
    }
    case "doc-chase": {
      const { what } = jobBits(input.job);
      const items = (input.items ?? []).map((s) => cleanText("Each document", s, LIMITS.itemChars));
      if (items.length === 0) throw new CommsInputError("Pick at least one document to ask for");
      if (items.length > LIMITS.maxItems) throw new CommsInputError(`At most ${LIMITS.maxItems} documents per message; draft a second message for the rest`);
      const unique = items.filter((s, i) => items.findIndex((x) => x.toLowerCase() === s.toLowerCase()) === i);
      for (const it of unique) facts.push({ kind: "item", value: it }, ...tokenFacts(it));
      const paragraphs = [`To complete your ${what}, we need the documents listed below.`, `Please send them by ${date(input.replyBy)}.`];
      if (input.job.statutoryDueOn) paragraphs.push(`The due date for filing is ${date(input.job.statutoryDueOn)}.`);
      return { ...base, kind: "doc-chase", subject: `Documents needed: ${what} (${clientName})`, paragraphs, items: unique, itemsAfter: 0, facts: normalizeFacts(facts), requiresAsk: true };
    }
    case "due-reminder": {
      const { what } = jobBits(input.job);
      if (isFiled(input.job.state)) throw new CommsInputError("This job is already filed; send a filing-completed note instead", 409);
      const due = requireDue(input.job);
      facts.push({ kind: "date", value: due });
      const amount = inr(input.amountInr, "The amount");
      if (amount) facts.push({ kind: "amount", value: amount });
      const by = date(input.replyBy);
      const paragraphs = [`This is a reminder that your ${what} is due on ${due}.`];
      if (input.ask === "payment") {
        if (!amount) throw new CommsInputError("Give the amount to pay for a payment reminder");
        paragraphs.push(`Please arrange the payment of ${amount} by ${by}.`);
      } else {
        if (amount) paragraphs.push(`The amount payable for this return is ${amount}.`);
        paragraphs.push(input.ask === "documents" ? `Please send any pending documents by ${by}.` : `Please confirm by ${by} that we may file it.`);
      }
      return { ...base, kind: "due-reminder", subject: `Reminder: ${what} is due on ${due} (${clientName})`, paragraphs, facts: normalizeFacts(facts), requiresAsk: true };
    }
    case "filing-completed": {
      const { what } = jobBits(input.job);
      const ack = input.job.ackRef ? oneLine(input.job.ackRef) : "";
      if (!input.job.filedAt || !ack) throw new CommsInputError("Record the filing first (Mark filed, with the ARN / SRN / acknowledgement number)", 409);
      facts.push({ kind: "ref", value: ack });
      const paragraphs = [`Your ${what} was filed on ${date(input.job.filedAt)}.`, `The acknowledgement number is ${ack}.`];
      const amount = inr(input.amountInr, "The amount paid");
      if (amount) {
        facts.push({ kind: "amount", value: amount });
        paragraphs.push(`The amount paid with this return was ${amount}.`);
      }
      return { ...base, kind: "filing-completed", subject: `${what} filed (${clientName})`, paragraphs, facts: normalizeFacts(facts), requiresAsk: false };
    }
    case "query-response": {
      if (input.job) jobBits(input.job);
      const topic = cleanText("The topic", input.topic, LIMITS.topicChars).replace(/[.?!]+$/, "");
      const answer = answerParagraphs(input.answer);
      facts.push({ kind: "topic", value: topic }, ...tokenFacts(topic), ...answer.flatMap(tokenFacts));
      const paragraphs = [`Thank you for your question about ${topic}.`, ...answer];
      if (countAsks(paragraphs.join("\n")) > 1) throw new CommsInputError("The answer asks the client for more than one thing; keep one ask per message");
      return { ...base, kind: "query-response", subject: `Your question about ${topic} (${clientName})`, paragraphs, facts: normalizeFacts(facts), requiresAsk: false };
    }
  }
}

/** The message body in plain text: greeting, paragraphs (with the list after `itemsAfter`), closing, signature. */
export function renderBody(parts: Pick<Template, "greeting" | "paragraphs" | "items" | "itemsAfter" | "closing" | "signature">): string {
  const blocks: string[] = [parts.greeting];
  parts.paragraphs.forEach((p, i) => {
    blocks.push(p);
    if (i === parts.itemsAfter && parts.items.length) blocks.push(parts.items.map((it) => `- ${it}`).join("\n"));
  });
  blocks.push([parts.closing, ...parts.signature].join("\n"));
  return blocks.join("\n\n");
}
