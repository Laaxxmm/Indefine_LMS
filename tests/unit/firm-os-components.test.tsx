// Shared Firm OS pieces (src/components/firm-os): variants, busy state, roles and the aria wiring
// that ties labels, hints, errors and consequences to their controls. Server-rendered HTML.
import { describe, expect, it, vi } from "vitest";
import type { JobTaskState } from "@prisma/client";
import { renderHtml } from "./routes/harness";

vi.mock("next/navigation", async () => (await import("./routes/harness")).navigationMock);

const fos = await import("@/components/firm-os");
const ui = await import("@/components/ui");
const { Alert, Button, buttonClass, Card, Chip, ConfirmPanel, ConfirmStep, DataTable, EmptyState, FormField, PageHeader, PartnerChip, RunStatusChip, Section, StateChip, describedBy } = fos;

const html = async (el: React.ReactElement) => (await renderHtml(el)).replace(/<!-- -->/g, "");
const tag = (out: string, name: string) => out.match(new RegExp(`<${name}[^>]*>`))?.[0] ?? "";

describe("Button", () => {
  it("each variant uses its ui.ts class string, with the focus ring and 32 px geometry", async () => {
    for (const [variant, cls] of [
      ["primary", ui.btnPrimary],
      ["secondary", ui.btnGhost],
      ["success", ui.btnSuccess],
      ["warn", ui.btnWarn],
      ["danger", ui.btnDanger],
    ] as const) {
      const b = tag(await html(<Button variant={variant}>Go</Button>), "button");
      expect(b).toContain(`class="${cls}`);
      expect(b).toContain("focus-visible:ring-2");
      expect(b).toContain("py-1.5");
      expect(b).toContain("leading-5");
      expect(b).toContain('type="button"');
    }
  });

  it("primary is the only filled brand variant", () => {
    expect(buttonClass("primary")).toContain("bg-brand-500");
    for (const v of ["secondary", "success", "warn", "danger"] as const) expect(buttonClass(v)).not.toContain("bg-brand-500");
  });

  it("busy: disabled, aria-busy, a hidden spinner and the busy label", async () => {
    const out = await html(
      <Button variant="primary" busy busyLabel="Saving…">
        Save
      </Button>,
    );
    const b = tag(out, "button");
    expect(b).toContain('disabled=""');
    expect(b).toContain('aria-busy="true"');
    expect(out).toMatch(/<svg[^>]*animate-spin[^>]*aria-hidden="true"|<svg[^>]*aria-hidden="true"[^>]*animate-spin/);
    expect(out).toContain("Saving…");
    expect(out).not.toContain(">Save<");
  });

  it("busy without a busy label keeps the label; idle has no spinner and no aria-busy", async () => {
    expect(await html(<Button busy>Run agent</Button>)).toContain("Run agent");
    const idle = await html(<Button>Run agent</Button>);
    expect(idle).not.toContain("animate-spin");
    expect(idle).not.toContain("aria-busy");
    expect(tag(idle, "button")).not.toContain('disabled=""');
  });

  it("sm size adds the compact modifiers; buttonClass styles a link the same way", async () => {
    expect(tag(await html(<Button size="sm">x</Button>), "button")).toContain(ui.btnSm);
    expect(buttonClass("secondary", "md", "whitespace-nowrap")).toBe(`${ui.btnGhost} whitespace-nowrap`);
  });
});

describe("Alert", () => {
  it("an error is role=alert; warning, info and success are role=status", async () => {
    expect(tag(await html(<Alert tone="error">Could not save</Alert>), "div")).toContain('role="alert"');
    for (const tone of ["warning", "info", "success"] as const) expect(tag(await html(<Alert tone={tone}>x</Alert>), "div")).toContain('role="status"');
  });

  it("tones use the AA pairs and a decorative icon; a title is the bold first line", async () => {
    const out = await html(
      <Alert tone="error" title="The agent could not finish this run">
        Timeout
      </Alert>,
    );
    expect(out).toContain("bg-rose-50");
    expect(out).toContain("text-rose-700");
    expect(out).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(out).toMatch(/<p class="font-bold">The agent could not finish this run<\/p>/);
    expect(await html(<Alert tone="warning">x</Alert>)).toContain("text-amber-800");
  });

  it("the role can be set (role=note for static guidance)", async () => {
    expect(tag(await html(<Alert tone="info" role="note">x</Alert>), "div")).toContain('role="note"');
  });
});

describe("PageHeader", () => {
  it("one h1 with the title, eyebrow and lead, the back link and the action slot", async () => {
    const out = await html(<PageHeader back={{ href: "/agents", label: "Agent runs" }} eyebrow="Firm OS" title="Mistake log" lead="Findings reviewers say an agent missed." action={<a href="/x">New draft</a>} />);
    expect(out.match(/<h1/g)).toHaveLength(1);
    expect(out).toMatch(/<h1 class="[^"]*font-display[^"]*">Mistake log<\/h1>/);
    expect(out).toContain('href="/agents"');
    expect(out).toContain("Agent runs");
    expect(out).toContain("Findings reviewers say an agent missed.");
    expect(out).toContain(">New draft</a>");
    expect(out).toContain("mb-6"); // header → content 24
  });
});

describe("Card and Section", () => {
  it("card padding is 24 (p-6); a section is labelled by its own title", async () => {
    expect(await html(<Card>x</Card>)).toContain("p-6");
    const out = await html(
      <Section id="waiting" title="Waiting for you">
        x
      </Section>,
    );
    expect(out).toContain('<section aria-labelledby="waiting"');
    expect(out).toMatch(/<h2 id="waiting" class="[^"]*uppercase[^"]*">Waiting for you<\/h2>/);
    expect(out).toContain("mb-8");
    expect(out).toContain("text-ink-mute");
    expect(out).not.toContain("text-ink-faint");
  });
});

describe("chips", () => {
  const STATES: JobTaskState[] = ["DRAFT", "ASSIGNED", "IN_PREP", "AGENT_DONE", "IN_REVIEW", "APPROVED", "FILED_BY_HUMAN", "CLOSING", "DONE"];

  it("StateChip shows every JobTask state by its exact name, 24 px tall", async () => {
    for (const s of STATES) {
      const out = await html(<StateChip state={s} />);
      expect(out).toContain(`>${s}</span>`);
      expect(out).toContain(`title="Job state: ${s}"`);
      expect(out).toContain("py-1");
      expect(out).toContain("leading-4");
    }
    expect(await html(<StateChip state="DONE" />)).toContain("bg-ink text-white");
    expect(await html(<StateChip state="IN_REVIEW" />)).toContain("bg-amber-50");
  });

  it("run status, partner and plain chips", async () => {
    expect(await html(<RunStatusChip status="AGENT_DONE" />)).toContain("Run: Pack ready");
    expect(await html(<RunStatusChip status="FAILED" />)).toContain("bg-rose-50");
    expect(await html(<PartnerChip />)).toContain("Needs partner");
    expect(await html(<Chip tone="success">Closed</Chip>)).toContain("text-emerald-800");
  });
});

describe("DataTable", () => {
  it("caption, th scope=col, right-aligned numbers, an sr-only action head, 44 px head row", async () => {
    const out = await html(
      <DataTable caption="Runs" columns={[{ label: "Job" }, { label: "Findings", align: "right" }, { label: "Action", srOnly: true }]}>
        <tr className={ui.tr}>
          <td className={ui.td}>a</td>
          <td className={ui.tdNum}>1</td>
          <td className={ui.td}>b</td>
        </tr>
      </DataTable>,
    );
    expect(out).toContain('<caption class="sr-only">Runs</caption>');
    expect(out.match(/<th scope="col"/g)).toHaveLength(3);
    expect(out).toMatch(/<th scope="col" class="[^"]*text-right[^"]*">Findings<\/th>/);
    expect(out).toContain('<span class="sr-only">Action</span>');
    expect(out).toContain("overflow-x-auto");
    expect(out).toContain("h-11");
    expect(out).not.toContain("sticky");
  });

  it("sticky keeps the head in view inside a bounded scroll box", async () => {
    const out = await html(
      <DataTable caption="Long" columns={[{ label: "A" }]} sticky>
        <tr />
      </DataTable>,
    );
    expect(out).toContain("max-h-[70vh]");
    expect(out).toMatch(/<th scope="col" class="[^"]*sticky top-0[^"]*bg-card/);
  });
});

describe("FormField", () => {
  it("label for the control; hint and error tied by id; the error is role=alert", async () => {
    const out = await html(
      <FormField id="ack" label="ARN" hint="From the portal acknowledgement" error="Enter the ARN" required>
        <input id="ack" aria-describedby={describedBy("ack", "h", "e")} />
      </FormField>,
    );
    expect(out).toMatch(/<label for="ack"[^>]*>ARN<span[^>]*> \(required\)<\/span><\/label>/);
    expect(out).toContain('aria-describedby="ack-hint ack-error"');
    expect(out).toMatch(/<p id="ack-hint"[^>]*>From the portal acknowledgement<\/p>/);
    expect(out).toMatch(/<p id="ack-error" role="alert"[^>]*>Enter the ARN<\/p>/);
  });

  it("describedBy is undefined with neither hint nor error", () => {
    expect(describedBy("x")).toBeUndefined();
    expect(describedBy("x", "hint")).toBe("x-hint");
  });
});

describe("EmptyState", () => {
  it("title, sentence and an optional action", async () => {
    const out = await html(<EmptyState title="No drafts yet" action={<a href="/comms/new">New draft</a>}>Start one from an agent run.</EmptyState>);
    expect(out).toContain("No drafts yet");
    expect(out).toContain("Start one from an agent run.");
    expect(out).toContain('href="/comms/new"');
    expect(out).toContain("border-dashed");
  });
});

describe("ConfirmStep", () => {
  it("first paint: only the trigger, nothing sent", async () => {
    const onConfirm = vi.fn(async () => true);
    const out = await html(<ConfirmStep label="Revoke Laptop" triggerLabel="Revoke" triggerVariant="danger" confirmLabel="Confirm revoke" consequence="The token stops working." onConfirm={onConfirm} />);
    expect(out).toContain(">Revoke</button>");
    expect(out).toContain("bg-rose-50");
    expect(out).not.toContain("Confirm revoke");
    expect(out).not.toContain("The token stops working.");
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("the panel: a labelled group, the consequence tied to the confirm button, Cancel beside it", async () => {
    const out = await html(<ConfirmPanel label="Approve rule X" consequence="Adds the rule to SOP pack v1.1.0." confirmLabel="Confirm approval" confirmVariant="success" onCancel={() => {}} onConfirm={() => {}} />);
    expect(out).toContain('role="group"');
    expect(out).toContain('aria-label="Confirm: Approve rule X"');
    const cid = out.match(/<p id="([^"]+)"[^>]*>Adds the rule/)?.[1];
    expect(cid).toBeTruthy();
    expect(out).toMatch(new RegExp(`<button[^>]*aria-describedby="${cid}"[^>]*>Confirm approval</button>`));
    expect(out).toContain(">Cancel</button>");
    expect(out).toContain("bg-emerald-50");
  });

  it("busy panel: confirm disabled with the spinner and Saving…, Cancel disabled", async () => {
    const out = await html(<ConfirmPanel label="x" consequence="c" confirmLabel="Confirm" busy onCancel={() => {}} onConfirm={() => {}} />);
    expect(out).toMatch(/<button[^>]*disabled[^>]*>Cancel<\/button>/);
    expect(out).toContain('aria-busy="true"');
    expect(out).toContain("Saving…");
  });
});
