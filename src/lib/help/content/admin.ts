import type { HelpEntry } from "../types";

export const ADMIN_HELP: HelpEntry[] = [
  // Source: src/app/admin/firm-os/models/page.tsx, src/app/admin/layout.tsx, src/app/workspace/ModuleLayout.tsx, src/lib/ai/usage.ts, src/lib/agents/core/guardrails/drift-db.ts, src/lib/workspace/flag.ts
  {
    route: "/admin/firm-os/models",
    title: "Model usage",
    purpose:
      "What the firm's AI work cost in rupees and how it went, by day, by agent and by provider. The Guardrails table shows, per agent per day, whether the AI started to drift past its limits.",
    steps: [
      "Pick the From and To dates and select Apply. The page opens on the last 30 days, and dates are in IST.",
      "Read the four tiles at the top: Cost, Model calls, Escalations and Queued for human.",
      "Use By day to spot a day that cost more than usual, then By agent and By provider to see where the cost came from.",
      "Scroll to Guardrails and look for a red Breach chip; it names the rate that went over its limit.",
      "Open the agent's runs for that day and check the work by hand before trusting more of its output.",
    ],
    terms: [
      { term: "Cost", meaning: "What the AI calls in the date range cost, in rupees." },
      {
        term: "Escalations",
        meaning: "Calls where the first answer was not good enough, so the work was tried again on a stronger model.",
      },
      {
        term: "Queued for human",
        meaning: "Calls the AI did not finish, so the work was handed to a person to do instead.",
      },
      {
        term: "Refused by the budget guard",
        meaning: "Calls that were stopped because a run or the firm's daily AI budget was used up. This line shows only when it happened.",
      },
      {
        term: "By provider",
        meaning: "Which AI service did the work: Claude, Grok, a local model, or no provider when the call was queued or refused.",
      },
      {
        term: "Guardrails",
        meaning:
          "Daily rates per agent, such as validator fails, escalations, ungrounded answers and reviewer overrides, each compared with its limit. A rate counts only once there are enough cases.",
      },
      {
        term: "Breach",
        meaning:
          "A rate went over its limit that day, or there was a scope violation, or a task had more ungrounded answers than its budget allows. Each breach is also written to the audit log when the page is opened.",
      },
      { term: "Within limits", meaning: "Nothing went over its limit for that agent on that day." },
    ],
    stuck: [
      {
        problem: "Opening Model usage takes you to the dashboard with a note that Firm OS is not switched on.",
        fix: "This page works only when IT has switched Firm OS on for the firm. Ask IT to switch it on when the firm is ready.",
      },
      {
        problem: "Model usage is missing from the admin menu.",
        fix: "It is hidden while Firm OS is switched off for the firm. Ask IT whether Firm OS has been switched on yet.",
      },
      {
        problem: "Every table says there were no model calls in this range.",
        fix: "No AI work ran in those dates. Widen the From and To dates and select Apply again.",
      },
      {
        problem: "Cost is high and many calls were refused by the budget guard.",
        fix: "The daily AI budget ran out. Check By agent to see which agent used it, and ask IT if the budget needs to change.",
      },
      {
        problem: "An agent shows a Breach chip on several days in a row.",
        fix: "Tell the partner who owns that agent's work, and have reviewers check its packs closely until the rate comes back within limits.",
      },
      {
        problem: "You want different guardrail limits.",
        fix: "The limits are set in the server settings. Ask IT to change them.",
      },
    ],
    ask: "Ask IT about the AI budget, the guardrail limits or switching Firm OS on, and the partner who owns an agent about a breach.",
  },

  // Source: src/app/admin/firm-os/mistakes/page.tsx, src/app/agents/mistakes/MistakesView.tsx, src/app/agents/mistakes/MistakeDecision.tsx, src/app/agents/mistakes/load.ts, src/lib/agents/views.ts
  {
    route: "/admin/firm-os/mistakes",
    title: "Mistake log",
    purpose:
      "Findings that reviewers say an agent missed or got wrong, each with the rule it would add to the SOP pack. Approving one adds the rule to a new version of the SOP pack, and nothing is added without a partner.",
    steps: [
      "Start with Waiting for a decision: each entry shows what was missed, the agent, the rule, who logged it and when.",
      "Read the green box under an entry: it shows the rule that would be added and the SOP pack version it would create.",
      "Select View the run to see the job where the mistake happened.",
      "If you are also a partner, select Approve rule or Reject, read what will happen, then select Confirm approval or Confirm rejection.",
      "Check Decided for entries already approved or rejected, with the version each approval created.",
    ],
    terms: [
      { term: "Waiting for a decision", meaning: "Proposed rules no partner has approved or rejected yet." },
      { term: "Proposed", meaning: "The rule is waiting for a partner's decision." },
      { term: "Approved", meaning: "The rule was added to the SOP pack, and every run after that uses it." },
      { term: "Rejected", meaning: "The rule was not added. The entry stays in the log for the record." },
      {
        term: "SOP pack",
        meaning: "The checklist rules an agent follows. Each approved rule makes a new minor version, so earlier runs keep the rules they used.",
      },
      { term: "No rule change", meaning: "The entry would not add any rule to the SOP pack." },
    ],
    stuck: [
      {
        problem: "You see the entries but no Approve rule or Reject buttons.",
        fix: "Only a partner can approve or reject a rule. Ask a partner to open the Mistake log and decide.",
      },
      {
        problem: "An entry shows a red line instead of the rule change, and has no buttons.",
        fix: "The rule cannot be added as it stands, for example because the agent's SOP pack is missing. Tell IT what the red line says.",
      },
      {
        problem: "You approved a rule by mistake.",
        fix: "An approval cannot be undone from this page. Tell a partner and IT straight away, before more runs use the rule.",
      },
      {
        problem: "Opening the Mistake log takes you to the dashboard with a note that Firm OS is not switched on.",
        fix: "This page works only when IT has switched Firm OS on for the firm. Ask IT to switch it on when the firm is ready.",
      },
    ],
    ask: "Ask a partner to approve or reject a rule, and IT about an entry that shows a red line.",
  },

  // Source: src/app/admin/firm-os/cycle-time/page.tsx, src/lib/close-loop/cycle-time.ts, src/lib/close-loop/cycle-time-db.ts
  {
    route: "/admin/firm-os/cycle-time",
    title: "Cycle time",
    purpose:
      "How long Firm OS jobs take from assignment to done, as the median and the p90, and which stage takes the biggest share of a typical job.",
    steps: [
      "Pick the From and To dates and select Apply. The page opens on the last 90 days, and only jobs that finished in that range count.",
      "Read the tiles: Jobs done, the median and the p90 from assigned to done, and the bottleneck stage.",
      "Use Time in each stage to see where jobs wait longest.",
      "Compare By service, By person (assignee) and By client to find the slow ones.",
      "Talk to the person or the team about the bottleneck stage, not just the total time.",
    ],
    terms: [
      { term: "Median", meaning: "Half the jobs took less time than this and half took more." },
      { term: "p90", meaning: "Nine jobs in ten took less time than this. It shows how long the slow jobs take." },
      { term: "Bottleneck stage", meaning: "The stage with the largest median share of a job's time." },
      { term: "Waiting to start", meaning: "Time from assignment until preparation began." },
      { term: "Preparation", meaning: "Time the job spent being prepared, by the agent and the preparer." },
      { term: "Review", meaning: "Time the job spent with the reviewer." },
      {
        term: "Waiting on client",
        meaning: "Time after a change whose note said the job was waiting on the client.",
      },
      { term: "Approved to filed", meaning: "Time from the reviewer's approval until a person filed it." },
      { term: "Filed to done", meaning: "Time from filing until the job was closed as done." },
    ],
    stuck: [
      {
        problem: "The tables say no jobs reached done in this range.",
        fix: "No Firm OS job finished in those dates. Widen the From and To dates and select Apply again.",
      },
      {
        problem: "A note says only the first 5,000 jobs in this range are included.",
        fix: "The range has too many jobs to count at once. Pick a shorter range and select Apply.",
      },
      {
        problem: "Waiting on client looks too low.",
        fix: "Only changes whose note says waiting on client are counted. Ask staff to write that in the note when a job waits for the client.",
      },
      {
        problem: "Opening Cycle time takes you to the dashboard with a note that Firm OS is not switched on.",
        fix: "This page works only when IT has switched Firm OS on for the firm. Ask IT to switch it on when the firm is ready.",
      },
    ],
    ask: "Ask the partner who runs the service about a slow stage, and IT if the page does not open.",
  },

  // Source: src/app/admin/firm-os/workspace/page.tsx, src/app/admin/firm-os/workspace/WorkspaceForms.tsx, src/lib/workspace/registry.ts, src/lib/workspace/settings.ts, src/lib/workspace/admin.ts, src/lib/workspace/access.ts, src/lib/workspace/flag.ts
  {
    route: "/admin/firm-os/workspace",
    title: "Workspace settings",
    purpose:
      "Choose which modules each role sees, and change them for one person when needed. Switching a module on never gives access that the person's role does not already have.",
    steps: [
      "On Role defaults, pick Staff, Manager, Partner or Admin, tick the modules that role should see, and choose whether Focus mode is on.",
      "On People, search by name or email, select Edit next to the person, and tick the box that gives them their own list of modules if they need something different from their role.",
      "For one person you can also set Focus mode to follow the role, on or off, and tick Allow the companion extension.",
      "Select Review changes, read the list of what will change, then select Confirm and save.",
      "Use Use built-in defaults for a role, or Reset to role default for a person, to go back to the starting settings.",
    ],
    terms: [
      { term: "Module", meaning: "One part of the app, such as Learning, Clients, Tools, Agents or Search, that can be switched on or off." },
      { term: "Role defaults", meaning: "The modules everyone in a role sees unless they have their own settings." },
      {
        term: "Built-in default",
        meaning: "The starting list used until you save one: staff get learning, leaderboard, work tracker, tools and the Firm OS work modules; managers also get clients, client messages and onboarding; partners and admins get everything.",
      },
      { term: "Focus mode", meaning: "The person's dashboard opens on their next task, one task at a time, with everything else folded away." },
      {
        term: "Allow the companion extension",
        meaning: "Lets the person pair the read-only side panel that shows the next task's steps beside the portal.",
      },
      {
        term: "Can open now",
        meaning: "The modules the person can really open: switched on for them and allowed by their role.",
      },
      { term: "Always on for admins", meaning: "Admins always keep the Admin module, so nobody can lock themselves out of this page." },
    ],
    stuck: [
      {
        problem: "A yellow note says Firm OS is switched off for the whole firm.",
        fix: "Nobody sees a Firm OS module yet and these settings are not used. Set the role defaults first, then ask IT to switch Firm OS on for the firm.",
      },
      {
        problem: "A module card has a note that switching it on has no effect.",
        fix: "That role or person is not allowed to use the module, so it stays hidden. Change their role or level in Team and hierarchy if they really need it.",
      },
      {
        problem: "Work tracker is ticked but the person still cannot open it.",
        fix: "The work tracker also needs the person on its own allow-list. Ask IT to add their email to it.",
      },
      {
        problem: "Review changes is greyed out.",
        fix: "Nothing has changed yet. Tick or untick a module or change focus mode, then select Review changes.",
      },
      {
        problem: "Search finds no one.",
        fix: "Check the spelling, or search by the person's email instead of their name.",
      },
      {
        problem: "You saved a change but the person still sees the old menu.",
        fix: "The change applies the next time they open a page. Ask them to reload the page.",
      },
    ],
    ask: "Ask IT to switch Firm OS on for the firm or to add someone to the work tracker's allow-list, and a partner before changing what a whole role sees.",
  },

  // Source: src/app/admin/firm-os/privacy/page.tsx, src/app/admin/firm-os/privacy/PrivacyForms.tsx, src/app/admin/firm-os/privacy/layout.tsx, src/lib/privacy/policy.ts, src/lib/privacy/register.ts, src/lib/privacy/access.ts
  {
    route: "/admin/firm-os/privacy",
    title: "Privacy requests",
    purpose:
      "The register of requests from clients, their contacts and staff under the DPDP Act 2023, with the firm's target date for each. It stays open whether or not Firm OS is switched on, because the duties cover all client data.",
    steps: [
      "Check the tiles first: Open, Overdue, Due within 7 days and On legal hold.",
      "To log a new request, pick the Kind of request, the Received on date and How it arrived, then enter at least one of PAN, GSTIN, email or phone.",
      "Write what the person asked for in Notes, then select Log request; the request opens on its own page.",
      "Use Status, Kind and Overdue only to filter the list, then select Apply.",
      "Select a request's name in the list to work on it; the list shows the earliest due first.",
    ],
    terms: [
      { term: "Kind of request", meaning: "Access to personal data, Correction, Erasure, Grievance, Nomination or Consent withdrawal." },
      { term: "Due", meaning: "The firm's target date: 30 days from receipt, or 7 days for a consent withdrawal." },
      { term: "Outer limit", meaning: "The latest date the firm understands the rules allow, 90 days from receipt. A partner or lawyer is to confirm it." },
      { term: "Overdue", meaning: "The target date has passed and the request is still open." },
      { term: "Verifying identity", meaning: "The request is logged and the person's identity is being checked." },
      { term: "On legal hold", meaning: "A law makes the firm keep some of the data, so it is held rather than erased." },
      { term: "Refused", meaning: "The request was closed with a written reason for refusing it." },
    ],
    stuck: [
      {
        problem: "Log request says to enter at least one identifier.",
        fix: "Enter the person's PAN, GSTIN, email or phone, so their records can be found, then select Log request again.",
      },
      {
        problem: "Log request says the date received can't be in the future.",
        fix: "Pick the day the request actually arrived in Received on, then select Log request again.",
      },
      {
        problem: "After logging, yellow notes appear instead of the request page.",
        fix: "The request was logged; read the notes, then select Open the request.",
      },
      {
        problem: "A partner who is not an admin cannot open this page.",
        fix: "This page is in the admin area, which only admins can open. Work the request together with an admin.",
      },
      {
        problem: "A request shows Overdue in red.",
        fix: "Open it and finish the next step today, or close it with the reply or the reason for refusing.",
      },
    ],
    ask: "Ask a partner or the firm's lawyer about the legal basis of a request, and another admin to help work the register.",
  },

  // Source: src/app/admin/firm-os/privacy/[id]/page.tsx, src/app/admin/firm-os/privacy/PrivacyForms.tsx, src/lib/privacy/register.ts, src/lib/privacy/policy.ts, src/lib/privacy/erasure.ts, src/lib/privacy/consent.ts, src/lib/rbac/policy.ts
  {
    route: "/admin/firm-os/privacy/[id]",
    title: "Privacy request",
    purpose:
      "One privacy request worked step by step: logged, identity verified, the step for its kind, then closed. Every step is recorded in the Timeline with who did it and when.",
    steps: [
      "In Step 1, check the request is linked to one record. If several records match, select This request is about this record on the right one, then Link to this record.",
      "In Step 2, pick how the identity was checked, select Mark identity verified, then Confirm identity verified.",
      "In Step 3, do the step for the kind of request: download the export, correct the records, confirm the erasure plan, restrict processing or record the nominee.",
      "In the last step, write the reply sent to the person or the reason for refusing, at least 10 characters long.",
      "Select Complete request, Send reply and close, or Refuse request, read what will happen, then confirm.",
    ],
    terms: [
      { term: "Due (firm target)", meaning: "The date the firm aims to reply by. The Outer limit below it is the latest date allowed." },
      {
        term: "Download export",
        meaning: "A file of the person's personal data for an access request. Send it only to them by a secure route; each download is recorded.",
      },
      {
        term: "Erasure plan",
        meaning: "Nothing is deleted. Each item is anonymised in place, kept under a legal hold where a law makes the firm keep it, or left as a manual step for a partner.",
      },
      { term: "Legal hold", meaning: "The item is kept unchanged until the date shown, because a law makes the firm keep it." },
      {
        term: "Restrict processing",
        meaning: "For a consent withdrawal: no new AI processing, no new message drafts, no growth or marketing use and, for staff, no break nudges.",
      },
      {
        term: "Restriction in force",
        meaning: "Agent runs, onboarding reading and message drafts for this person are refused until a partner lifts the restriction.",
      },
      { term: "Timeline", meaning: "Every step taken on the request, with who did it and when, in IST." },
    ],
    stuck: [
      {
        problem: "Step 1 says the identifiers match several different records.",
        fix: "Choose the record the request is about with This request is about this record, then Link to this record. Nothing is shared, changed or erased until you do.",
      },
      {
        problem: "Step 1 says no matching records were found.",
        fix: "Log the request again with another identifier, or close this one with Refuse request and the reason.",
      },
      {
        problem: "Step 3 says to verify identity first.",
        fix: "Finish Step 2 with Mark identity verified and Confirm identity verified, then come back to Step 3.",
      },
      {
        problem: "Refuse request or Complete request stays greyed out.",
        fix: "Write at least 10 characters in the reply or reason box, then select the button again.",
      },
      {
        problem: "A correction is for a staff member.",
        fix: "Staff details are corrected in Admin, Team and hierarchy. Make the change there, then close this request with the reply.",
      },
      {
        problem: "The page says only a partner can lift the restriction.",
        fix: "Ask a partner to open this request, write the reason and select Lift restriction.",
      },
      {
        problem: "You closed a request by mistake.",
        fix: "A closed request cannot be reopened. Log a new request for the same person.",
      },
    ],
    ask: "Ask a partner to lift a restriction or to check an erasure plan before you confirm it, and the firm's lawyer about the legal basis or a hold date.",
  },

  // Source: src/app/admin/firm-os/breaches/page.tsx, src/app/admin/firm-os/breaches/BreachForms.tsx, src/app/admin/firm-os/breaches/parts.tsx, src/lib/privacy/breach.ts, src/lib/privacy/policy.ts
  {
    route: "/admin/firm-os/breaches",
    title: "Breach register",
    purpose:
      "Personal data breaches and their notice clocks, counted from when the firm became aware. It stays open whether or not Firm OS is switched on, because the duties cover all client data.",
    steps: [
      "Check the tiles: Open incidents, Board reports overdue, Notices to people overdue and Incidents recorded.",
      "To record a new incident, enter when the firm became aware (IST), the Severity and the people affected if known.",
      "Describe what happened without any personal details, then select Record incident; the incident opens on its own page.",
      "Watch Notice clocks of open incidents: each shows the hours left for the Board report and for telling affected people.",
      "Follow the breach runbook linked at the top of the page while you work the incident.",
    ],
    terms: [
      {
        term: "Board report",
        meaning: "The report to the Data Protection Board, due 72 hours after the firm became aware. Legal is to confirm this period.",
      },
      {
        term: "Affected people",
        meaning: "Telling each affected person. The firm's target is the same 72 hours as the Board report.",
      },
      { term: "Open", meaning: "The incident is recorded and nothing has been done to contain it yet." },
      { term: "Contained", meaning: "A containment step has been recorded." },
      { term: "Notified", meaning: "Both the Board and the affected people have been told." },
      { term: "Closed", meaning: "The incident is finished. Anything new needs a new incident." },
      { term: "Severity", meaning: "Low, medium or high, as you judge it. You can change it later." },
    ],
    stuck: [
      {
        problem: "Record incident says to describe what happened.",
        fix: "Write a sentence or two of at least 10 characters, leave out personal details, then select Record incident again.",
      },
      {
        problem: "Record incident says the time can't be in the future.",
        fix: "Enter the date and time the firm became aware, in IST, then select Record incident again.",
      },
      {
        problem: "A clock shows hours overdue in red.",
        fix: "Open the incident now, send the notice, and record it with Record that the Board was told or Record that affected people were told.",
      },
      {
        problem: "A partner who is not an admin cannot open this page.",
        fix: "This page is in the admin area, which only admins can open. Tell an admin about the breach straight away.",
      },
    ],
    ask: "Tell a partner and the firm's lawyer about any breach straight away, and ask IT for help containing it.",
  },

  // Source: src/app/admin/firm-os/breaches/[id]/page.tsx, src/app/admin/firm-os/breaches/BreachForms.tsx, src/lib/privacy/breach.ts, src/lib/privacy/policy.ts
  {
    route: "/admin/firm-os/breaches/[id]",
    title: "Data breach",
    purpose:
      "One breach incident: its two notice clocks, the next step to record, and the timeline of what was done. Use it to contain the breach, record the notices and close it.",
    steps: [
      "Read the two clocks, Board report and Affected people, and what legal is to confirm under each.",
      "In Next step, pick a step: Add a containment step, Record that the Board was told, Record that affected people were told, Update severity or people affected, or Close the incident.",
      "For a notice, enter when it was sent (IST) and, if you have one, the reference of the notice, select Record notice, then confirm.",
      "For a containment step, write what was done, then select Save step.",
      "When both notices are recorded, choose Close the incident, write the closing note, select Close incident, then Confirm close.",
    ],
    terms: [
      { term: "Became aware", meaning: "When the firm learned of the breach. Both clocks count from this time." },
      { term: "Due", meaning: "When the notice must be sent, 72 hours after the firm became aware." },
      { term: "Add a containment step", meaning: "Records what was done to stop the breach. The first one moves the incident to Contained." },
      {
        term: "Record notice",
        meaning: "Stops that clock at the time you enter. It cannot be changed afterwards, so check the time first.",
      },
      { term: "Closing note", meaning: "What happened, what was done, and what will change so it does not happen again." },
      { term: "Timeline", meaning: "Every step recorded on the incident, with who recorded it and when, in IST." },
    ],
    stuck: [
      {
        problem: "Close incident says to record when the Board and the affected people were told.",
        fix: "Record both notices first with Record that the Board was told and Record that affected people were told, then close the incident.",
      },
      {
        problem: "A notice says it can't be sent before the firm became aware.",
        fix: "Check the date and time you entered, in IST, and enter the time the notice was really sent.",
      },
      {
        problem: "Save step says to say what was done to contain the breach.",
        fix: "Write at least 10 characters about what was done, then select Save step again.",
      },
      {
        problem: "You recorded a notice with the wrong time.",
        fix: "A recorded notice cannot be changed. Tell the firm's lawyer, and write the correct time in the closing note when you close the incident.",
      },
      {
        problem: "The page says the incident is closed.",
        fix: "A closed incident cannot be changed. Go back to the Breach register and record a new incident if something more has happened.",
      },
    ],
    ask: "Ask the firm's lawyer about the notices, a partner about what to tell clients, and IT about containing the breach.",
  },
];
