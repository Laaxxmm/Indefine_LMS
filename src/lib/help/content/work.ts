import type { HelpEntry } from "../types";

export const WORK_HELP: HelpEntry[] = [
  // Source: src/app/focus/page.tsx, src/app/workspace/parts.tsx, src/app/workspace/NextActionButton.tsx, src/lib/workspace/next-task.ts
  {
    route: "/focus",
    title: "Next task",
    purpose: "Shows the one job that needs you most right now, why it comes first, its SOP steps and the one action to take. Nothing on this page files, submits or sends anything.",
    steps: [
      "Read Why this is next to see what the job needs and when it is due.",
      "Choose the main button, such as Run agent, Open pack to submit, Review pack, Mark filed or Record Turia close, to open the screen where that step is done.",
      "Follow the SOP steps; the step marked Now is the one you are on.",
      "Check every point under Before you move on before you leave the step.",
      "Choose Open the guided workspace to see the job's SOP steps beside its documents.",
      "When the step is done, choose Done? Show next task to get the next job.",
    ],
    terms: [
      { term: "Why this is next", meaning: "What the job needs from you, its due dates, and why it comes ahead of your other jobs. The order is the same as on My day: anything past its statutory date first, then past its internal date, then the rest." },
      { term: "SOP steps", meaning: "The firm's steps for this kind of job. Done steps are ticked, and the current step is marked Now." },
      { term: "Before you move on", meaning: "What must be true before this step is finished." },
      { term: "Open questions", meaning: "Points the agent could not settle: ask the client for a document, decide it yourself where two reads disagreed, or check it by hand." },
      { term: "Done? Show next task", meaning: "Asks again for your next job. If the same job is still first, the page tells you what it still needs." },
      { state: "ASSIGNED", meaning: "The job is assigned and the preparer runs the agent next." },
      { state: "IN_PREP", meaning: "The preparer is preparing the pack." },
      { state: "AGENT_DONE", meaning: "The agent has finished the draft pack. The preparer checks its findings and submits it for review." },
      { state: "IN_REVIEW", meaning: "The pack is with the reviewer." },
      { state: "APPROVED", meaning: "The reviewer approved the pack. The preparer files it on the portal and then marks it filed." },
    ],
    stuck: [
      {
        problem: "The page says Nothing is waiting for you right now.",
        fix: "You have no job to act on. New work appears here when a job is assigned to you or a pack is sent to you for review; choose Check again later, or ask your manager if you expected a job.",
      },
      {
        problem: "After Done? Show next task, the page says This task still needs you.",
        fix: "The job has not moved yet. Do the step the message names, for example submit the pack on the review screen, then choose Done? Show next task again.",
      },
      {
        problem: "Run agent says the AI service is not set up on the server.",
        fix: "The firm's AI key is missing, so no agent can run. Ask IT to add the AI key, and meanwhile prepare the pack by hand.",
      },
      {
        problem: "Run agent says the AI service is unavailable right now.",
        fix: "Wait a few minutes and choose Run agent again, or prepare the pack by hand.",
      },
      {
        problem: "Run agent says you have made too many agent runs and asks you to wait some minutes.",
        fix: "Wait the number of minutes the message gives, then choose Run agent again.",
      },
      {
        problem: "You were sent to the dashboard with a note that Agents is turned off for your account.",
        fix: "Next task belongs to the Agents module. Ask an admin to turn Agents on for you in Workspace settings.",
      },
    ],
    ask: "Ask your manager about which job should come first, and an admin if Next task does not open for you.",
  },
  // Source: src/app/workspace/[jobId]/page.tsx, src/app/workspace/parts.tsx, src/lib/workspace/view.ts, src/lib/workspace/sop-steps.ts
  {
    route: "/workspace/[jobId]",
    title: "Guided workspace",
    purpose: "Shows one job with its SOP steps and next action on the left, and its deliverables, client documents and SOP pack on the right. It belongs to Next task, and it never opens or links a government portal.",
    steps: [
      "Check the job's state, due dates and the Next action in the left panel.",
      "Choose the Next action button to do the step, or read who acts next if there is nothing for you to do.",
      "Work through the SOP steps; the one marked Now is the current step, and Before you move on lists what must be true first.",
      "Use the tabs on the right: Deliverables for the draft pack's files, Client documents for this period's files in SharePoint, and SOP pack for the checks the agent runs.",
      "For a job you file on a portal, file it in your own browser with this page open beside it.",
      "Choose Next task at the top to go back to your next job.",
    ],
    terms: [
      { term: "Next action", meaning: "The one step you can take on this job now. If someone else acts next, the page says who." },
      { term: "Deliverables", meaning: "The files of the latest agent run's draft pack. Choose Open the pack review screen to review, submit or approve it." },
      { term: "Client documents", meaning: "The client's documents recorded for this period, each opening in SharePoint in a new tab. The agent reads them from the ClientDocs folder." },
      { term: "SOP pack", meaning: "The checks the agent runs for this service, from the active published pack, or the built-in pack when nothing is published yet." },
      { term: "Block, Warning and Note", meaning: "How serious a check in the SOP pack is. A Block must be cleared, a Warning needs a look, and a Note is for information." },
      { term: "Overdue", meaning: "The internal or statutory due date has passed." },
      { state: "FILED_BY_HUMAN", meaning: "The filing is recorded. The Turia task still has to be closed with the time spent." },
      { state: "CLOSING", meaning: "The job is waiting for the Turia close to be recorded." },
      { state: "DONE", meaning: "The job is finished. Nothing more is needed." },
    ],
    stuck: [
      {
        problem: "The Next action says Nothing for you to do here right now.",
        fix: "Someone else holds the next step, and the sentence after it says who. Wait for them, or choose Next task to go to your own next job.",
      },
      {
        problem: "The page says there is no agent for this service yet.",
        fix: "Prepare the work by hand in the job's Working folder, following the SOP steps on this page.",
      },
      {
        problem: "Client documents says No documents are recorded for this client yet.",
        fix: "Put this period's documents in the ClientDocs folder in SharePoint, using the folder link at the top of the tab; the agent reads them from there.",
      },
      {
        problem: "The link to this period's ClientDocs folder is missing.",
        fix: "The job's client code or period does not fit the firm's folder layout, so no folder link can be made. Ask your manager to check the job's client code and period.",
      },
      {
        problem: "Deliverables says No agent run yet.",
        fix: "Choose Run agent under Next action if you prepare the job; the draft pack's files appear here after the run.",
      },
      {
        problem: "You want to open the portal from this page.",
        fix: "The page never links or embeds a portal. Open the portal in your own browser and file it there yourself; the companion side panel can show these steps next to it.",
      },
    ],
    ask: "Ask the job's preparer or reviewer about a step they hold, and your manager if a job's details or folder look wrong.",
  },
  // Source: src/app/coach/page.tsx, src/app/coach/CoachSettings.tsx, src/app/coach/NoticeList.tsx, src/lib/agents/coach/board.ts, src/lib/agents/coach/reminders.ts
  {
    route: "/coach",
    title: "My day",
    purpose: "Lists your open jobs in the order to take them, your notices, your weekly summary and your own reminder and break settings. Only you see your reminders and break settings.",
    steps: [
      "Start with Must today, then This week, then Everything else; each list is already in the order to take the jobs.",
      "Read Why now to see why a job sits where it does.",
      "Use the button on a row, such as Open in Waiting for you, Open pack to submit, Review pack, Open pack to file or Open pack to close, to go where the next step is done.",
      "Read your Notices and choose Dismiss when you have dealt with one.",
      "Check Your week for your Friday summary.",
      "Under Reminders and breaks, tick or untick Morning board and Break reminders; each change saves at once.",
    ],
    terms: [
      { term: "Must today", meaning: "Jobs past due, due internally today, or due statutorily by the next working day." },
      { term: "This week", meaning: "Jobs due within the next five working days." },
      { term: "Why now", meaning: "The reason a job is in its place, such as being past due or near its statutory date." },
      { term: "Filed, waiting to close", meaning: "Jobs you filed. A job is done once the final file is in SharePoint and the Turia task is closed with time logged." },
      { term: "Morning board", meaning: "A notice at 09:00 IST on working days with what must be done today and this week. The board on this page stays either way." },
      { term: "Reminder", meaning: "A notice to whoever holds the next step, about two hours and about thirty minutes before the internal due time of 18:00 IST." },
      { term: "Escalation", meaning: "A notice once the internal due date has passed, to the job's reviewer, or to the manager when the reviewer holds the step. At most one a day for each job." },
      { term: "Your week", meaning: "A short summary each Friday at 16:00 IST: jobs done, time from assignment to done, and the longest stage. You and your manager see it." },
      { term: "Your team's week", meaning: "For managers: the latest weekly summary of each person who reports to you." },
      { term: "Break reminders", meaning: "A short reminder after about 100 minutes of continuous work, at most 3 a day. Snooze 30 min or Snooze 60 min pauses them, and Resume now turns them back on." },
    ],
    stuck: [
      {
        problem: "Must today says Nothing must be done today.",
        fix: "Nothing of yours is past due or due today. Look at This week for what comes next.",
      },
      {
        problem: "A job you work on is not on My day.",
        fix: "My day lists only jobs where the next move is yours. If someone else holds the step, it shows on their board instead.",
      },
      {
        problem: "Your week says No summary yet.",
        fix: "The first summary appears on Friday at 16:00 IST. Check again after then.",
      },
      {
        problem: "Reminders and breaks says Break reminders are not turned on for the firm.",
        fix: "Break reminders are a firm-wide choice and nothing about your activity is recorded. Ask an admin if the firm wants to use them.",
      },
      {
        problem: "Break reminders interrupt you during focused work.",
        fix: "Choose Snooze 30 min or Snooze 60 min, or untick Break reminders.",
      },
      {
        problem: "You were sent to the dashboard with a note that Daily Coach is turned off for your account.",
        fix: "Ask an admin to turn Daily Coach on for you in Workspace settings.",
      },
    ],
    ask: "Ask your manager about the order of your jobs or an escalation, and an admin if My day does not open for you.",
  },
  // Source: src/app/comms/page.tsx, src/lib/agents/comms/service.ts, src/lib/agents/comms/types.ts
  {
    route: "/comms",
    title: "Client messages",
    purpose: "Lists the client message drafts you can open, newest first. Nothing here sends email: you copy a draft or open it as an Outlook draft, check it and send it yourself.",
    steps: [
      "Pick a client in the Client list and choose Filter to see only that client's drafts.",
      "Choose Clear filter to see all drafts again.",
      "Choose a subject to open that draft.",
      "Choose New draft to write a new message.",
    ],
    terms: [
      { term: "Type", meaning: "What the message is for: Status update, Documents needed, Due-date reminder, Filing completed, or Answer to a question." },
      { term: "Language", meaning: "The language of the draft. A translated draft always keeps the English below it." },
      { term: "Outlook", meaning: "Draft created means the message was already put in the author's Outlook Drafts folder." },
      { term: "Prepared (IST)", meaning: "When the draft was made, and who made it." },
      { term: "One job", meaning: "The list shows only the drafts for the job you came from." },
    ],
    stuck: [
      {
        problem: "The page says No drafts yet.",
        fix: "Start one from an agent run, a client page, or New draft.",
      },
      {
        problem: "A colleague's draft is not in your list.",
        fix: "You see a draft only if you wrote it, prepare or review its job, or handle the client; managers, partners and admins see all. Ask the author to share the text, or ask your manager.",
      },
      {
        problem: "A client is missing from the Client list.",
        fix: "The list holds only clients whose jobs you prepare or review. Ask your manager to add you to the client's job if you need to write to them.",
      },
      {
        problem: "You were sent to the dashboard with a note that Client comms drafts is turned off for your account.",
        fix: "Ask an admin to turn Client comms drafts on for you in Workspace settings.",
      },
    ],
    ask: "Ask your manager about drafts you cannot see, and an admin if Client messages does not open for you.",
  },
  // Source: src/app/comms/new/page.tsx, src/app/comms/new/DraftForm.tsx, src/lib/agents/comms/service.ts, src/lib/agents/comms/compose.ts, src/lib/agents/comms/drafting.ts
  {
    route: "/comms/new",
    title: "New client message",
    purpose: "Prepares a draft message to a client from the job's facts. The wording comes from the firm's template; the AI may only polish it and translate it, and nothing is sent.",
    steps: [
      "If asked Which client is the message for, pick the client and choose Continue.",
      "Pick the Job, or No job for a general answer to the client.",
      "Under What is the message for, choose the kind of message.",
      "Fill in what that kind asks for: the documents to ask for, the one thing the client should do, Reply needed by, the amount, or the client's question and your answer.",
      "Check the Language, and tick the PAN or Aadhaar box only if the client asked for it in this message.",
      "Choose Prepare draft; you see the draft before anything else happens.",
    ],
    terms: [
      { term: "Status update", meaning: "Where the job stands, and its due date." },
      { term: "Documents needed", meaning: "The documents you need and the date you need them by. Suggestions come from the agent run; you can edit them or choose Add for more." },
      { term: "Due-date reminder", meaning: "The due date, with one ask: Confirm we may file, Send pending documents, or Arrange the payment." },
      { term: "Filing completed", meaning: "The filing date and the acknowledgement number you recorded." },
      { term: "Answer to a question", meaning: "Your answer to the client's question, in plain words, with one ask at most." },
      { term: "Not available", meaning: "That kind of message cannot be drafted for the job you picked; the reason is shown beside it." },
      { term: "The client asked for their PAN or Aadhaar", meaning: "When ticked, the number is shown masked to the last 4 characters. Otherwise it is left out of the message." },
      { term: "Language", meaning: "The client's preferred language is picked for you. A translation always keeps the English below it for you to check." },
    ],
    stuck: [
      {
        problem: "A kind of message is greyed out with Not available.",
        fix: "Do what the reason says: pick a job first, add a due date to the job, or mark the job filed with its ARN or SRN before a Filing completed message.",
      },
      {
        problem: "The form says the reply-by date is in the past or after the due date.",
        fix: "Pick a date from today up to the job's due date.",
      },
      {
        problem: "The draft came back with a note starting Template wording or No translation.",
        fix: "The AI service could not help, for example because the firm's AI key is not set up, so the firm's template wording or the English alone was used. Check the wording yourself before sending, and ask IT to add the AI key if it keeps happening.",
      },
      {
        problem: "The form says the client has restricted AI processing or asked for no new message drafts.",
        fix: "Write to the client by hand, or ask a partner to lift the restriction.",
      },
      {
        problem: "The form says you have made too many draft messages and asks you to wait some minutes.",
        fix: "Wait the number of minutes the message gives, then choose Prepare draft again.",
      },
      {
        problem: "The client list says No Firm OS clients you prepare or review yet.",
        fix: "You can draft only for clients whose jobs you prepare or review. Ask your manager to add you to the job.",
      },
    ],
    ask: "Ask a partner to lift a client's restriction, and IT if the AI service is not set up.",
  },
  // Source: src/app/comms/[id]/page.tsx, src/app/comms/[id]/DraftActions.tsx, src/lib/agents/comms/service.ts, src/app/connect/page.tsx
  {
    route: "/comms/[id]",
    title: "Client message draft",
    purpose: "Shows one client message draft with notes to check, and lets you copy it or put it in your own Outlook Drafts folder. The app never sends it: you send it yourself from Outlook.",
    steps: [
      "Read every point under Check before you send.",
      "Check the Subject and the To line; change the recipient in Outlook if needed.",
      "Read the message; a translated draft shows the English beside it.",
      "Choose Open in Outlook draft to put the message in the Drafts folder of your mailbox and open it in a new tab.",
      "Check the draft in Outlook and send it yourself from there.",
      "Or choose Copy to copy the subject and message and paste them where you need them.",
    ],
    terms: [
      { term: "Check before you send", meaning: "Notes and tone warnings about this draft, such as template wording being used or identity numbers left out." },
      { term: "Template wording", meaning: "The firm's own wording was used because the AI did not polish it." },
      { term: "Open in Outlook draft", meaning: "Puts the message in the Drafts folder of your own Outlook mailbox and opens it. It does not send anything." },
      { term: "Open it again", meaning: "Opens the same Outlook draft again, for example if your browser blocked the new tab." },
      { term: "Copy", meaning: "Copies the subject and the message so you can paste them yourself." },
      { term: "Outlook draft made before", meaning: "Opening again finds the same draft while it is still a draft in Outlook, instead of making a second one." },
    ],
    stuck: [
      {
        problem: "Open in Outlook draft says Connect your Microsoft 365 mailbox first.",
        fix: "Your mailbox permission (Mail.ReadWrite) is missing. Choose Connect mailbox, then Connect Microsoft 365 and accept, and come back and choose Open in Outlook draft again.",
      },
      {
        problem: "Open in Outlook draft says Outlook refused the draft.",
        fix: "Choose Connect mailbox, then Reconnect, and try Open in Outlook draft again.",
      },
      {
        problem: "Open in Outlook draft says Outlook could not create the draft.",
        fix: "Wait a minute and try again, or choose Copy and paste the message into a new Outlook email.",
      },
      {
        problem: "The Subject card says No contact e-mail on the client record.",
        fix: "Add the recipient yourself in Outlook before you send.",
      },
      {
        problem: "Copy says your browser did not allow copying.",
        fix: "Select the subject and message text on the page and copy them yourself.",
      },
      {
        problem: "The draft opened in Outlook but nothing was sent.",
        fix: "That is expected: the app never sends. Check the draft in your Outlook Drafts folder and choose Send there.",
      },
    ],
    ask: "Ask IT if connecting your Microsoft 365 mailbox keeps failing, and the draft's author or your manager about its content.",
  },
  // Source: src/app/search/page.tsx, src/app/search/SearchPanel.tsx, src/components/CommandPalette.tsx, src/lib/search/copy.ts, src/lib/search/query.ts, src/lib/search/rate-limit.ts, src/lib/search/identifiers.ts
  {
    route: "/search",
    title: "Search",
    purpose: "Finds clients, jobs, agent runs, deliverables, comms drafts and onboarding records that you are allowed to open. The search icon (the magnifying glass) in the header, or Ctrl+K (Cmd+K on a Mac), opens the same search over any page.",
    steps: [
      "Type a client name or code, a job title, a period or a file name; results appear as you type.",
      "To find a client by PAN, GSTIN, phone or email, type the full value and press Enter.",
      "Choose a type, such as Clients or Firm OS jobs, to see only that kind of result, or All types for everything.",
      "Press the down arrow to move into the results, Enter to open one, and Esc to go back to the box.",
      "In the Ctrl+K search, choose See all results to open this page with the same search.",
    ],
    terms: [
      { term: "All types", meaning: "Searches every kind of record you may open. The other buttons limit the search to one kind." },
      { term: "Searched by", meaning: "For a PAN, GSTIN, phone or email search, the value is shown masked: the last 4 of a PAN or phone, the state code and last 4 of a GSTIN, and the first letter and domain of an email." },
      { term: "Searches by PAN, GSTIN, phone or email are logged", meaning: "Each such search is recorded with who searched and what kind, without the number itself. These searches need the full value and never go in the page address." },
      { term: "Showing the first", meaning: "There are more results of that kind. Choose Show only that kind, or add a word to narrow the search." },
      { term: "Ctrl+K", meaning: "Opens the search over any page; Cmd+K on a Mac. Use the arrows to move, Enter to open and Esc to close." },
    ],
    stuck: [
      {
        problem: "The search says it needs the full PAN, GSTIN, phone number or email address.",
        fix: "Type the whole value, such as the 10-character PAN or the 15-character GSTIN, then press Enter.",
      },
      {
        problem: "The search says you have searched by PAN, GSTIN, phone or email too many times and asks you to wait some minutes.",
        fix: "Wait the number of minutes shown, or search by the client's name or code instead.",
      },
      {
        problem: "The search says Firm OS does not keep Aadhaar numbers.",
        fix: "Search by the client's name, PAN or phone instead.",
      },
      {
        problem: "The page says searches by PAN, GSTIN, phone or email are not run from the page address.",
        fix: "Type the full value in the search box and press Enter.",
      },
      {
        problem: "A record you expected does not appear.",
        fix: "You see only what you may open. Check the spelling, try the client code or fewer words, or choose All types.",
      },
      {
        problem: "Ctrl+K does nothing, or you were sent to the dashboard with a note that Search is turned off for your account.",
        fix: "Ask an admin to turn Search on for you in Workspace settings.",
      },
    ],
    ask: "Ask an admin if Search is turned off for you, and your manager if you need to see a client or job you cannot open.",
  },
  // Source: src/app/companion/page.tsx, src/app/companion/CompanionPanel.tsx, src/lib/companion/messages.ts, src/lib/companion/config.ts, src/lib/rbac/policy.ts
  {
    route: "/companion",
    title: "Companion",
    purpose: "Pairs the Firm OS Companion, a Chrome side panel that keeps your current task's steps beside the page you are working on. It only reads your task list and never reads, fills or submits a web page, or files, signs, pays or sends anything.",
    steps: [
      "Get the Firm OS Companion extension folder from your admin, open the Extensions page in Chrome, turn on Developer mode and choose Load unpacked.",
      "On this page, type a Name for this pairing, such as Office desktop, and choose Create pairing code.",
      "Choose Copy to copy the code, then choose I have copied it; the code is shown only once.",
      "Right-click the companion's toolbar icon, choose Options, paste the code and choose Save and test connection.",
      "Click the toolbar icon to open the side panel beside the page you are working on.",
      "To stop a browser, choose Revoke on its row and then Confirm revoke.",
    ],
    terms: [
      { term: "Pairing code", meaning: "The code that links one browser to your task list. It works for 90 days in one browser, or until you revoke it, and Firm OS cannot show it again." },
      { term: "Who may pair", meaning: "Admins and partners, and anyone an admin has turned the Companion on for in Workspace settings." },
      { term: "Active pairings", meaning: "The browsers paired now, at most 5 at a time." },
      { term: "Last used (IST)", meaning: "When that browser last asked for your task." },
      { term: "Revoke", meaning: "Stops that browser showing your tasks at its next refresh. It cannot be undone, but you can create a new pairing at any time." },
      { term: "Not turned on for you", meaning: "The Companion is not switched on for your account, so you cannot pair a browser." },
    ],
    stuck: [
      {
        problem: "The page says Not turned on for you.",
        fix: "Ask an admin to turn the Companion on for you in Workspace settings.",
      },
      {
        problem: "Create pairing code is greyed out and the page says you have 5 active pairings.",
        fix: "Revoke a pairing you no longer use, then create a new one.",
      },
      {
        problem: "You lost the pairing code before pasting it.",
        fix: "Revoke that pairing and create a new one; the old code cannot be shown again.",
      },
      {
        problem: "The side panel says Firm OS does not recognise this pairing code.",
        fix: "Check that you pasted all of the code on the Options page, or create a new one on this page.",
      },
      {
        problem: "The side panel says your pairing has expired or was revoked.",
        fix: "Create a new pairing code on this page and paste it on the companion's Options page.",
      },
      {
        problem: "The side panel says Too many refreshes in a short time.",
        fix: "Wait a minute, then try again.",
      },
      {
        problem: "Copy says Copy blocked.",
        fix: "Select the code on the page and copy it yourself.",
      },
    ],
    ask: "Ask an admin to turn the Companion on for you or to give you the extension folder.",
  },
  // Source: src/app/onboard/page.tsx, src/app/onboard/OnboardPanel.tsx, src/lib/agents/onboarding/extract.ts, src/lib/agents/onboarding/saga.ts, src/lib/agents/onboarding/service.ts, src/lib/errors/index.ts
  {
    route: "/onboard",
    title: "Onboard a client",
    purpose: "Sets up a new client from one sentence: you answer only what is missing, see exactly what will be created, and then follow the progress and any Turia checklists. Partners, managers and admins can use it.",
    steps: [
      "Under Describe the client, write the client in one sentence, such as the name, type, services, assignee and reviewer, and choose Continue.",
      "Check Understood so far, answer the questions, or type a correction under Or say it in plain English, and choose Continue.",
      "Read What will be created, then choose Create, or Change answers to go back.",
      "Watch each step's progress; if one stops, fix what it says and choose Retry.",
      "For each Turia checklist, follow the numbered steps in Turia, enter the Turia reference and the minutes if asked, and choose Done in Turia.",
      "Choose Start another client when you are finished.",
    ],
    terms: [
      { term: "Understood so far", meaning: "What was read from your sentence and answers. Check every field before you create anything." },
      { term: "Checks by hand", meaning: "Points Firm OS cannot check for you, to be checked by a person later." },
      { term: "What will be created", meaning: "The client record, the Turia client and tasks or checklists, the SharePoint site and folders, the people and the jobs. Nothing is created before you choose Create." },
      { term: "Waiting on you", meaning: "The step needs you to act first, such as completing Turia checklists." },
      { term: "Blocked", meaning: "The step is waiting for a setup task by a person, often IT, before it can carry on." },
      { term: "Failed step", meaning: "A step marked Failed stopped with an error; the reason is shown under it." },
      { term: "Retry", meaning: "Carries on from the first step that is not done. Nothing already created is created twice, and nothing is deleted." },
      { term: "Done in Turia", meaning: "Records that you completed a Turia checklist, with its Turia reference." },
      { term: "Masked", meaning: "PAN, GSTIN, phone numbers and names are hidden before any text reaches a cloud AI model." },
    ],
    stuck: [
      {
        problem: "The page says the description could not be read automatically, or automatic reading is not available right now.",
        fix: "The AI service could not read the sentence, for example because the firm's AI key is not set up. Answer the questions instead; onboarding works without it, and ask IT to add the AI key.",
      },
      {
        problem: "The page says the model was not confident about this sentence.",
        fix: "Check every field under Understood so far and correct anything wrong before you continue.",
      },
      {
        problem: "A step says it needs IT to finish setting up the connection to Microsoft 365 or Turia.",
        fix: "Nothing was lost. Ask IT to finish the setup, such as the client's SharePoint site, then choose Retry.",
      },
      {
        problem: "Create says a client with this name, folder name or PAN already exists.",
        fix: "Search for the client instead of adding it again, and ask a partner if it needs a second record.",
      },
      {
        problem: "The page says this client has restricted AI processing.",
        fix: "Answer the questions by hand, or ask a partner to lift the restriction.",
      },
      {
        problem: "The page says you have made too many onboarding requests and asks you to wait some minutes.",
        fix: "Wait the number of minutes the message gives, then try again.",
      },
      {
        problem: "An onboarding link says someone else started it.",
        fix: "Only the person who started an onboarding or a partner can open it. Ask them to carry it on.",
      },
      {
        problem: "You were sent to the dashboard with a note that Onboard client (Firm OS) is turned off for your account.",
        fix: "Ask an admin to turn Onboard client (Firm OS) on for you in Workspace settings.",
      },
    ],
    ask: "Ask IT about a blocked Microsoft 365 or Turia step, and a partner about a client that already exists or is restricted.",
  },
];
