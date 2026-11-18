import type { HelpEntry } from "../types";

export const AGENT_HELP: HelpEntry[] = [
  // Source: src/app/agents/page.tsx, src/app/agents/parts.tsx, src/lib/agents/views.ts (listMyJobs, listRuns), src/lib/agents/access.ts, src/lib/workspace/guard.ts, src/lib/hardening/rate-limit.ts
  {
    route: "/agents",
    title: "Agents",
    purpose:
      "Your agent work queue and the list of agent runs. An agent prepares a draft pack, a person checks every finding, approves it and files it; the app never files or sends anything.",
    steps: [
      "Start with Waiting for you: it lists the jobs you prepare or review that you can act on now, soonest internal due date first.",
      "Select \"Run agent\" on a job you prepare to have the agent build its draft pack.",
      "Select \"Open pack to submit\" to check a pack the agent prepared for you, or \"Review pack\" to review a pack someone submitted to you.",
      "Use the runs table below to reopen any run you can see; the job name opens the run's review page.",
      "To see one agent's jobs and runs, pick it in the second row: GST Prep, Books Close, Audit Assist, ROC Prep or Tax Prep.",
    ],
    terms: [
      {
        term: "Waiting for you",
        meaning:
          "Jobs where you are the preparer or the reviewer and there is something for you to do now. A job with nothing for you to do, such as one you prepared that is now in review, is left out.",
      },
      {
        term: "Whose runs you see",
        meaning:
          "Staff see the runs on jobs assigned to them or that they review; the line under the title says so. Managers, partners and admins see every run.",
      },
      { term: "Internal due", meaning: "The firm's own target date for the job." },
      {
        term: "Findings",
        meaning: "How many checklist items failed on the run. Block items stop approval; warning items need a look but do not stop it.",
      },
      {
        term: "Run: Pack ready",
        meaning: "The agent finished and its draft pack is ready to check. Other run labels are Running, Failed, Changes requested and Approved.",
      },
      {
        term: "Attempt",
        meaning: "Which run this is for the job. A re-run or a change request starts a new attempt and keeps the old one for the record.",
      },
      {
        state: "DRAFT",
        meaning: "The job is still being set up and has no preparer, so it does not show here until a manager or a partner assigns it.",
      },
      { state: "ASSIGNED", meaning: "The job has a preparer and is waiting for the agent to run." },
      { state: "IN_PREP", meaning: "The job is in preparation, so the agent can run on it, or run again." },
      { state: "AGENT_DONE", meaning: "The agent has prepared the pack. The preparer checks it and submits it for review." },
      { state: "IN_REVIEW", meaning: "The pack is with the reviewer to approve or send back with a note." },
    ],
    stuck: [
      {
        problem: "Waiting for you says \"Nothing waiting for you\".",
        fix: "Nothing needs you right now. Jobs you prepare appear when they are assigned or in preparation, and packs you review appear once the preparer submits them; ask your manager if you expected a job.",
      },
      {
        problem: "A job says there is no agent for its service yet.",
        fix: "No agent prepares that kind of work yet. Prepare the job by hand the usual way.",
      },
      {
        problem: "You cannot find a run a colleague mentioned.",
        fix: "Staff see only runs on jobs they prepare or review. Ask a manager or a partner to open it, since they see every run.",
      },
      {
        problem: "Opening Agents takes you to the dashboard with a message that Agents is turned off for your account.",
        fix: "The Agents module is switched off for you. Ask an admin to turn it on in Workspace settings.",
      },
      {
        problem: "The dashboard says Firm OS is not switched on for the firm yet.",
        fix: "The agents are not in use at the firm yet. Ask an admin if you expected to use them.",
      },
      {
        problem: "Run agent says you have made too many agent runs and asks you to wait.",
        fix: "Each person can start only a set number of agent runs in an hour. Wait the number of minutes the message gives, then select \"Run agent\" again.",
      },
      {
        problem: "Run agent says the system is busy, or that you already have a run going.",
        fix: "Other runs are using the server. Wait for your own run to finish, or wait a minute, then try again.",
      },
    ],
    ask: "Ask your manager about a job that should be waiting for you, and an admin if the Agents pages are switched off for you.",
  },

  // Source: src/app/agents/[agent]/page.tsx, src/app/agents/[agent]/RunAgentButton.tsx, src/lib/agents/service.ts (startAgentRun), src/lib/agents/core/inputs.ts, src/lib/errors/index.ts (runFailureMessage), src/lib/errors/messages.ts
  {
    route: "/agents/[agent]",
    title: "Agent page",
    purpose: "One agent, such as GST Prep or Books Close: the jobs it can prepare for you now, and its earlier runs.",
    steps: [
      "Pick the agent in the second row, under the Firm OS header.",
      "Make sure the client's files for the period are in the period's client documents folder on the client's SharePoint site; the agent reads the files there.",
      "Under Jobs ready for the agent, select \"Run agent\" on the job. The button shows \"Running…\" while the agent works.",
      "When the run finishes, its review page opens on its own; check the checklist and the files there.",
      "Use the Runs table to reopen any earlier run of this agent.",
    ],
    terms: [
      {
        term: "Jobs ready for the agent",
        meaning: "Jobs of this agent's kind that are assigned or in preparation and that you may run it on. Staff see only jobs assigned to them.",
      },
      {
        term: "Run agent",
        meaning: "Starts the agent on that job. It reads the client's files, runs its checklist and saves a draft pack for review; nothing is filed or sent.",
      },
      {
        term: "SOP pack",
        meaning: "The agent's checklist, published by a partner. The run page shows which version each run used.",
      },
      { term: "Run: Failed", meaning: "The agent could not finish. Open the run to read why and what to do." },
      {
        term: "Run: Changes requested",
        meaning: "The reviewer sent this run back with a note, and a new attempt started with that note.",
      },
      { state: "ASSIGNED", meaning: "The job has a preparer; running the agent moves it into preparation." },
      { state: "IN_PREP", meaning: "The job is in preparation, so the agent can run on it again." },
    ],
    stuck: [
      {
        problem: "The page says \"Nothing to run\".",
        fix: "No job of this kind is assigned to you and waiting for the agent. Check Waiting for you on the Agents page, or ask your manager to assign the job.",
      },
      {
        problem: "Run agent says only the person the job is assigned to, a manager or a partner can run the agent.",
        fix: "The agent runs only while the job is assigned or in preparation, and only for its preparer, a manager or a partner. Ask the preparer or your manager.",
      },
      {
        problem: "Run agent says the agent's SOP pack has not been published yet.",
        fix: "Ask a partner to publish this agent's SOP pack, then run the agent again.",
      },
      {
        problem: "Run agent says this client has restricted AI processing.",
        fix: "Prepare the job by hand, or ask a partner to lift the restriction for this client.",
      },
      {
        problem: "The run failed because the AI service is not set up on the server.",
        fix: "The firm's AI key has not been added. Ask IT to add it, or prepare the pack by hand.",
      },
      {
        problem: "The run failed saying the connection to Microsoft 365 is not set up.",
        fix: "This also shows when the client's SharePoint site is not ready yet. Check that the client's onboarding is finished; if it still fails, ask IT to finish the Microsoft 365 setup.",
      },
      {
        problem: "The run failed because an input file was refused or a spreadsheet could not be read safely.",
        fix: "Check the files in the period's client documents folder: remove any password, and split a very large spreadsheet into smaller files, such as one month per file. Then run the agent again.",
      },
      {
        problem: "Run agent says you have made too many agent runs.",
        fix: "Wait the number of minutes the message gives, then select \"Run agent\" again.",
      },
    ],
    ask: "Ask your manager to assign a job to you, a partner to publish the agent's SOP pack, and IT when the AI service or Microsoft 365 is not set up.",
  },

  // Source: src/app/agents/[agent]/runs/[id]/page.tsx, src/app/agents/[agent]/runs/[id]/ReviewPanels.tsx, src/lib/agents/views.ts (loadRunReview, openQuestionViews), src/lib/agents/core/state.ts, src/lib/close-loop/review.ts, src/lib/close-loop/gate.ts, src/lib/close-loop/actions.ts
  {
    route: "/agents/[agent]/runs/[id]",
    title: "Run review",
    purpose:
      "Check the draft pack an agent prepared, decide on it, then record the filing and the Turia close. You file on the portal yourself; this page never files anything or contacts the client.",
    steps: [
      "Read the header first: the job state chip, the run label and, if shown, Needs partner.",
      "Work through the Checklist, starting with Block and Warning items; read each quote and open its location to see the source.",
      "Settle every item under Open questions, because approval does not wait for them.",
      "Open the files under Deliverables with \"Preview\" or \"Download\", and add a comment if something needs saying.",
      "Use the bar at the bottom for your next step: \"Submit for review\" or \"Re-run with a note\" as the preparer, \"Approve pack\" or \"Request changes\" as the reviewer.",
      "After you file on the portal, select \"Mark filed\" and enter the acknowledgement number, such as the GST ARN or the MCA SRN.",
      "Close the task in Turia yourself, then enter the Turia task ref and the minutes and select \"Record Turia close\".",
    ],
    terms: [
      {
        term: "Block and Warning",
        meaning:
          "Checklist items that failed. A block finding stops approval unless a partner approves with a note; a warning needs a look but does not stop approval. Check by hand marks a rule the agent could not test.",
      },
      {
        term: "Open questions",
        meaning:
          "What the documents did not show, two model reads that disagreed, or a rule outside this agent's checks. Approval does not wait for them, so settle each one first.",
      },
      {
        term: "Client document request",
        meaning:
          "The documents did not show the answer, so the agent did not guess. Ask the client yourself; on a GST run, ITC held back until answered shows the credit the draft keeps out until then.",
      },
      { term: "Needs partner", meaning: "Some of the AI work in this run was flagged for a partner to look at." },
      {
        term: "Mark filed",
        meaning:
          "Records, against your name, that you filed on the portal, with the acknowledgement number where the service has one. Firm OS stores the number but never checks it with the portal.",
      },
      {
        term: "Record Turia close",
        meaning:
          "After you close the task in Turia and log your minutes there, records the task ref and minutes here and runs the closing checks.",
      },
      {
        state: "AGENT_DONE",
        meaning: "The agent has prepared the pack. The preparer checks it, then submits it for review or re-runs the agent with a note.",
      },
      {
        state: "IN_REVIEW",
        meaning: "The pack is with the reviewer to approve or send back. The person who prepared the job cannot approve it unless they are a partner.",
      },
      {
        state: "APPROVED",
        meaning: "The pack is approved and its files are copied to the Final folder as a new version. File on the portal, then select \"Mark filed\".",
      },
      {
        state: "FILED_BY_HUMAN",
        meaning: "A named person recorded the portal filing. The job moves on to closing straight after.",
      },
      {
        state: "CLOSING",
        meaning: "Filed and waiting for the closing checks: the Final file in SharePoint and the Turia close with minutes logged.",
      },
      {
        state: "DONE",
        meaning:
          "Closed by the closing checks: filed, Final file confirmed in SharePoint and Turia task closed. Nobody can mark a job done by hand, and a done job is never reopened.",
      },
    ],
    stuck: [
      {
        problem: "There is no \"Approve pack\" button and the bar says only a partner can approve over block findings.",
        fix: "Select \"Request changes\" with a note so the agent runs again, or ask a partner to review; a partner approving over a block finding must add a note.",
      },
      {
        problem: "You prepared this job and there is no \"Approve pack\" button for you.",
        fix: "The person who prepared a job cannot approve it unless they are a partner. Ask the job's reviewer, a manager or a partner to approve it.",
      },
      {
        problem: "The page says a newer run exists for this job.",
        fix: "This run is kept for the record only. Go back to the agent page and open the latest run to act on it.",
      },
      {
        problem: "Filing and close says the Final file is not in Final yet, or the bar shows \"Copy to Final\".",
        fix: "Select \"Copy to Final\" to copy the approved files to the Final folder in SharePoint; the job cannot close without a Final file.",
      },
      {
        problem: "The job stays in closing after you select \"Record Turia close\".",
        fix: "Read the reasons under Filing and close and fix each one, such as moving the Final file back into the Final folder or entering the minutes logged, then select \"Check again\".",
      },
      {
        problem: "You marked the job filed with the wrong acknowledgement number.",
        fix: "Ask a manager or a partner to select \"Retract filing\" and give a note. The job goes back to approved, and you mark it filed again with the right number.",
      },
      {
        problem: "The agent could not finish this run because the AI service is not set up or is unavailable.",
        fix: "If it is not set up, ask IT to add the firm's AI key; if it is unavailable, wait a few minutes and run the agent again. You can also prepare the pack by hand.",
      },
      {
        problem: "Re-running or requesting changes says you have made too many agent runs.",
        fix: "Wait the number of minutes the message gives, then try again; the job has not moved.",
      },
    ],
    ask: "Ask the job's reviewer or a manager to approve or send back a pack, a partner to approve over block findings, and a manager or a partner to retract a filing.",
  },

  // Source: src/app/agents/mistakes/page.tsx, src/app/agents/mistakes/MistakesView.tsx, src/app/agents/mistakes/MistakeDecision.tsx, src/app/agents/[agent]/runs/[id]/ReviewPanels.tsx (MistakeForm), src/lib/agents/access.ts
  {
    route: "/agents/mistakes",
    title: "Mistake log",
    purpose:
      "Findings reviewers say an agent missed or got wrong, each with a proposed rule. A partner decides, and an approved rule goes into a new version of the agent's SOP pack that every later run uses.",
    steps: [
      "On a run page, open \"Log a missed or wrong finding\", say what the agent missed, fill in the rule and select \"Propose rule\".",
      "The proposal then shows here under Waiting for a decision, with the rule it would add and the SOP pack version it would create.",
      "Select \"View the run\" to see the run the finding came from.",
      "As a partner, select \"Approve rule\" or \"Reject\", read what it will do, then select \"Confirm approval\" or \"Confirm rejection\".",
      "Find earlier decisions under Decided, with the SOP pack version each approved rule went into.",
    ],
    terms: [
      { term: "Waiting for a decision", meaning: "Proposed rules that no partner has decided on yet." },
      {
        term: "Proposed, approved or rejected",
        meaning: "The chip on each rule. An approved rule's chip also shows the SOP pack version it went into.",
      },
      {
        term: "SOP pack",
        meaning: "The agent's checklist. Approving a rule adds it to a new minor version, and every run after that uses it.",
      },
      { term: "Rule code", meaning: "A short name for the rule, such as gst.itc-blocked-motor." },
      {
        term: "Severity",
        meaning: "Block, Warning or Note: how serious a failure of the rule is. A block finding stops approval unless a partner approves with a note.",
      },
      {
        term: "Checked by",
        meaning: "A registered rule reuses one of the agent's existing checks; a model question asks the AI and needs a quote and a location as evidence.",
      },
      { term: "Evidence a finding must cite", meaning: "What a finding has to point to, such as the invoice number and row." },
    ],
    stuck: [
      {
        problem: "You do not see \"Approve rule\" or \"Reject\".",
        fix: "Only a partner can decide, because an approved rule changes the SOP pack. Ask a partner.",
      },
      {
        problem: "Mistake log is missing from the second row, or opening it takes you back to Agents.",
        fix: "The log is open to partners, managers and admins. Log the finding from the run page and ask a manager or a partner to check it.",
      },
      {
        problem: "A proposal shows a red message instead of the buttons.",
        fix: "The rule cannot be added as written, for example because the agent's SOP pack is not published. Log the finding again with a corrected rule, or ask a partner.",
      },
      {
        problem: "Propose rule says the settings could not be read.",
        fix: "Leave Parameters empty, or write each setting as a name in quotes and a value inside braces, for example {\"limit\": 2000000}.",
      },
      {
        problem: "Waiting for a decision says \"Nothing waiting\".",
        fix: "No proposal needs a decision. Reviewers add them from a run page with \"Log a missed or wrong finding\".",
      },
    ],
    ask: "Ask a partner to approve or reject a proposed rule, since only partners can change the SOP pack.",
  },

  // Source: src/app/agents/spot-checks/page.tsx, src/app/agents/spot-checks/SpotCheckAction.tsx, src/lib/audit/spot-checks.ts, src/lib/close-loop/gate.ts (isSpotCheckSelected), src/lib/rbac/policy.ts (canSpotCheck)
  {
    route: "/agents/spot-checks",
    title: "Turia spot checks",
    purpose:
      "Staff record Turia closes by hand, so about one in ten is picked for a partner to check. You check the task ref and the minutes in Turia and record it here.",
    steps: [
      "Open Spot checks from the More menu in the Firm OS header, or from Menu on a phone. Only partners see it.",
      "Under To check, read the job, the client, the Turia task ref, the minutes logged and who confirmed the close.",
      "Open that task in Turia and check that the task ref and the minutes logged match.",
      "Select \"Checked in Turia\", add a note if you want, then select \"Confirm check\".",
      "Find recorded checks under Checked, with who checked, when and the note.",
    ],
    terms: [
      {
        term: "Spot check",
        meaning: "A partner's check of a Turia close that someone recorded by hand. It is the firm's control on closes people report themselves.",
      },
      { term: "To check", meaning: "Closes picked for a spot check whose job is done, oldest first." },
      { term: "Turia task ref", meaning: "The task's reference in Turia, typed in by the person who recorded the close." },
      { term: "Confirmed by", meaning: "The person who recorded the Turia close in Firm OS." },
      {
        term: "Checked in Turia",
        meaning: "Records that you checked the task ref and the minutes in Turia. It cannot be undone, and the job stays done either way.",
      },
      { term: "Selected (IST)", meaning: "When the closing checks picked this close, in Indian time." },
    ],
    stuck: [
      {
        problem: "Opening Spot checks sends you back to the Agents page.",
        fix: "Only a partner can see and record Turia spot checks. Ask a partner.",
      },
      {
        problem: "The page says \"Nothing to check\".",
        fix: "No close is waiting. A picked close appears here once its job is done.",
      },
      {
        problem: "The task ref or the minutes in Turia do not match what was recorded.",
        fix: "Write what differs in the note when you record the check, and raise it with the person under Confirmed by. Recording the check changes nothing on the job or in Turia.",
      },
      {
        problem: "Recording says someone already recorded this spot check.",
        fix: "The first record stands. Reload the page to see it under Checked.",
      },
      {
        problem: "Recording says the note is too long.",
        fix: "Keep the note under 500 characters, then select \"Confirm check\" again.",
      },
    ],
    ask: "Ask a partner to record a spot check, since only partners can see this page.",
  },
];
