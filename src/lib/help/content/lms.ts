import type { HelpEntry } from "../types";

export const LMS_HELP: HelpEntry[] = [
  // Source: src/app/dashboard/page.tsx, src/lib/workspace/nav.ts, src/lib/workspace/settings.ts, src/lib/workspace/guard.ts, src/app/workspace/ModuleOffNotice.tsx, src/lib/gamification.ts, src/components/UserMenu.tsx, src/components/SearchButton.tsx
  {
    route: "/dashboard",
    title: "Home",
    purpose:
      "Your home page: your courses and assignments, live sessions, your streak and growth, and quick links to attendance. If your firm uses Firm OS, it can also open on your next task.",
    steps: [
      "Use the top bar to move around: Home, the Learn menu, Tools, Clients, the Firm OS menu and Work, then Search, Help, your streak and your account menu. On a phone the same links are under Menu.",
      "To carry on with training, select Continue on the Pick up where you left off card, or open a course under Your courses.",
      "Check Next deadline and My assignments, and select Open or Open module on anything still pending.",
      "Join a live session from its card with Join or Join now when one is scheduled for you.",
      "Mark your attendance from Attendance and daily punch, which opens greytHR, and open Turia from the card next to it.",
      "If focus mode is on for you, start with Your next task and select Open your next task; select Show everything to see the rest of the page.",
    ],
    terms: [
      { term: "Learn", meaning: "The menu with Courses, Leaderboard, Check-in and Recap." },
      {
        term: "Firm OS",
        meaning: "The menu with Next task, Agents, My day and Client messages. It shows only when Firm OS is switched on for the firm and these parts are on for you.",
      },
      {
        term: "Top bar links",
        meaning: "Each link shows only when that part of the app is on for you and your role allows it, so a link you do not need may not be there.",
      },
      { term: "Search", meaning: "Opens firm-wide search. Press Ctrl+K, or Cmd+K on a Mac, from any page." },
      {
        term: "Streak",
        meaning: "How many days in a row you have opened the app, watched a video or taken a quiz. Opening this page counts for today.",
      },
      { term: "Points and level", meaning: "Points come from videos watched, quizzes passed, deadlines met and attendance, and they raise your level." },
      { term: "Trajectory", meaning: "Your growth score across six areas that make up your KRA, rolled into a tier." },
      {
        term: "Focus mode",
        meaning: "An admin's setting that opens your home page on your next task, one task at a time, with the rest folded under Show everything.",
      },
      { term: "Account menu", meaning: "Your name at the top right: My team, Admin console for admins, Initiatives and Sign out." },
      { term: "Tour button", meaning: "The round question mark at the bottom right replays the short tour of this page. This Help panel is the written guide." },
    ],
    stuck: [
      {
        problem: "A note at the top says a part of the app is turned off for your account.",
        fix: "You were sent here from a page that is switched off for you. If you need it, ask an admin to turn it on in Workspace settings.",
      },
      {
        problem: "A note at the top says Firm OS is not switched on for the firm yet.",
        fix: "Everything else works as before. Ask an admin if you expected to use Firm OS.",
      },
      {
        problem: "A link you expected, such as Clients or Tools, is missing from the top bar.",
        fix: "That part of the app is not on for your role or your account. Ask an admin to check Workspace settings for you.",
      },
      {
        problem: "Work is missing from the top bar.",
        fix: "The work tracker opens only for people on its own list. Ask IT to add your email if you need it.",
      },
      {
        problem: "Your courses says no courses allotted yet.",
        fix: "Your admin assigns your training, and it appears here as soon as something is allotted to you. Ask your admin if you expected a course.",
      },
      {
        problem: "The page shows only your next task.",
        fix: "Focus mode is on for you. Select Show everything to open the rest of the page.",
      },
      {
        problem: "Your streak went back to zero.",
        fix: "A day was missed. Open the app or watch a video every day to build it again.",
      },
    ],
    ask: "Ask an admin about a missing link, a switched-off part of the app or a course you expected, and your manager about your assignments.",
  },

  // Source: src/app/tools/layout.tsx, src/app/tools/page.tsx, src/app/tools/office-tools/page.tsx, src/app/tools/office-tools/engagement-letter/LetterActions.tsx, src/app/tools/sop-builder/page.tsx, src/app/tools/sop-builder/SopCreator.tsx, src/lib/sop/access.ts, src/lib/certificates/access.ts, src/lib/neo-centra/access.ts, src/lib/errors/messages.ts
  {
    route: "/tools",
    section: true,
    title: "Tools",
    purpose:
      "The firm's internal tools in one place: certificates, SOPs, documents and tax tools, statutory updates, client ops and client onboarding. Each card opens one tool, and each tool keeps a record of what was made.",
    steps: [
      "Open Tools from the top bar to see All tools, one card per tool, then select Open on the card you need.",
      "Fill in the tool's form and check the preview or the brief before you generate anything.",
      "Download the file the tool makes, or find it in SharePoint or the L&D drive where the tool says it saves it.",
      "Use the History page of the certificate generator or of Document and tax tools to find something made earlier.",
      "Select All tools in the header at any time to go back to the list of tools.",
    ],
    terms: [
      { term: "All tools", meaning: "The list of every tool you can open. Onboard client (Firm OS) and Neo Centra show only to the people allowed to use them." },
      { term: "Soon", meaning: "A tool that is not ready yet. Its card cannot be opened." },
      { term: "History", meaning: "The record of certificates or documents made earlier, with who made them and when." },
      {
        term: "Create Outlook draft",
        meaning: "Puts the email, with the file attached, in the Drafts folder of your own Outlook. The app never sends it; you check it and send it yourself.",
      },
      { term: "L&D drive", meaning: "The shared training folder where the SOP builder saves a Word copy of each SOP." },
      { term: "Needs action", meaning: "A statutory update that asks the firm to do something, as opposed to one that is for information only." },
      { term: "SOP editor", meaning: "A person an admin has allowed to create and edit SOPs for their own department. Everyone else can view them." },
    ],
    stuck: [
      {
        problem: "Opening Tools takes you to the dashboard with a note that Tools is turned off for your account.",
        fix: "Tools is switched off for you. Ask an admin to turn it on in Workspace settings.",
      },
      {
        problem: "A tool says you don't have access and to ask an admin.",
        fix: "Your account may be inactive or the tool may be limited to some people. Ask an admin to check your account and give you access.",
      },
      {
        problem: "Create Outlook draft says to connect your Microsoft 365 mailbox first.",
        fix: "Select Connect mailbox, sign in with your firm account, then come back and select Create Outlook draft again.",
      },
      {
        problem: "A tool says the connection to SharePoint or Microsoft 365 is not set up on the server.",
        fix: "The file could not be saved to SharePoint. Ask IT to finish the Microsoft 365 setup, then try again.",
      },
      {
        problem: "The SOP builder says the AI service is not set up on the server, or the SOP draft could not be prepared.",
        fix: "Nothing was saved. Try again in a minute, or write the SOP by hand; if it says the AI service is not set up, ask IT to add the AI key.",
      },
      {
        problem: "The SOP builder says you have view access only.",
        fix: "Ask an admin to make you an SOP editor in the SOP builder's admin page. Editors can work only on their own department's SOPs.",
      },
      {
        problem: "A certificate will not download and says only the issuer or an admin can download it.",
        fix: "Ask the person who issued it, or an admin, to download it for you.",
      },
      {
        problem: "Neo Centra says the Turia sign-in has expired.",
        fix: "Sign in to Turia again and paste the new session details on the Neo Centra page.",
      },
    ],
    ask: "Ask an admin for access to a tool or for SOP editor rights, and IT when a tool says Microsoft 365, SharePoint or the AI service is not set up.",
  },

  // Source: src/app/clients/layout.tsx, src/app/clients/page.tsx, src/app/clients/[id]/page.tsx, src/app/clients/[id]/ClientPanels.tsx, src/app/clients/[id]/FirmOsJobs.tsx, src/app/clients/new/page.tsx, src/app/clients/new/OnboardForm.tsx, src/app/clients/reports/page.tsx, src/app/clients/admin/services/page.tsx, src/lib/clients/core.ts, src/lib/clients/storage.ts, src/lib/integrations/sharepoint/flags.ts, src/app/api/clients
  {
    route: "/clients",
    section: true,
    title: "Clients",
    purpose:
      "The firm's client database: every client with their jobs and their documents on SharePoint. You can onboard a new client, keep their jobs up to date, upload documents and report on the client base.",
    steps: [
      "Find a client in All clients: type a name or code, or a full PAN, GSTIN, phone or email, pick any filters, then select Filter.",
      "Select Onboard client, fill in the client details, the first job and any KYC documents, then select Onboard client to save.",
      "On a client's page, change a job's handler, status, due date, notes or fees in the Jobs table, or add a job with Add job.",
      "To file a document, pick what it belongs to and the document type under Documents, then select Upload files.",
      "Use Reports to filter jobs and group them by year, department, service, handler or turnover band, then select Apply.",
    ],
    terms: [
      { term: "Onboard", meaning: "The form for a new client. The client's SharePoint folders are created automatically when you save it." },
      { term: "Primary handler", meaning: "The person responsible for the client. They can change the client's jobs." },
      { term: "KYC (client-level)", meaning: "Documents that belong to the client itself, such as the PAN, rather than to one job." },
      {
        term: "SharePoint folders not created yet",
        meaning: "The client's or a job's folder is not ready on SharePoint, so uploads will fail until it is. Retry tries to create it again.",
      },
      { term: "Show", meaning: "Reveals a masked PAN, GSTIN, phone or email. Only admins and partners see it, and each view is recorded." },
      {
        term: "Firm OS jobs",
        meaning: "A read-only list of the client's Firm OS jobs with their state, internal due date and assignee. Select Open run to work on one.",
      },
      { term: "Services", meaning: "The admins' list of services under each department, which feeds the service pickers." },
      { term: "Rebuild database workbook", meaning: "Remakes the client database workbook on SharePoint from the latest records." },
    ],
    stuck: [
      {
        problem: "Opening Clients takes you to the dashboard with a note that Clients is turned off for your account.",
        fix: "Clients is switched off for you. Ask an admin to turn it on in Workspace settings.",
      },
      {
        problem: "A yellow note says SharePoint folders are not created yet and uploads will fail.",
        fix: "Select Retry on the note. If the note stays, tell IT that the client's SharePoint folder could not be created.",
      },
      {
        problem: "The onboard form says the client was saved but some files did not upload.",
        fix: "Select Open client, then upload the missing files again under Documents.",
      },
      {
        problem: "An upload fails because the file is over 50 MB.",
        fix: "Make the file smaller or split it into parts of 50 MB or less, then select Upload files again.",
      },
      {
        problem: "Saving a new client says a client with that name already exists.",
        fix: "Open the existing client from All clients instead of adding it again.",
      },
      {
        problem: "Changing a job says only the client's handler, the job's handler, an admin or a partner can change it.",
        fix: "Ask the handler, an admin or a partner to make the change.",
      },
      {
        problem: "You cannot see Edit, Show, Download Excel or the remove buttons.",
        fix: "These are for admins and partners only. Ask one of them, and note that a job can be removed only once it has no documents.",
      },
      {
        problem: "The Firm OS jobs card is missing, or says there are no jobs that you prepare or review.",
        fix: "The card shows only when IT has linked client folders to Firm OS and the client has a Firm OS client code, and staff see only their own jobs. Ask a manager or a partner to check.",
      },
    ],
    ask: "Ask the client's handler or a partner about the client's jobs, an admin to switch Clients on or change the services list, and IT about SharePoint folders.",
  },
];
