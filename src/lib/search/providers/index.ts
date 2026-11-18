// The providers, in SEARCH_TYPES order. Add an entity by writing a provider (provider.ts contract)
// and listing it here; the service, the API and the UI pick it up.
import type { SearchProvider } from "../provider";
import { clientJobsProvider } from "./client-jobs";
import { clientsProvider } from "./clients";
import { deliverablesProvider } from "./deliverables";
import { documentsProvider } from "./documents";
import { draftsProvider } from "./drafts";
import { firmJobsProvider } from "./firm-jobs";
import { onboardingProvider } from "./onboarding";
import { runsProvider } from "./runs";

export const PROVIDERS: readonly SearchProvider[] = [
  clientsProvider,
  firmJobsProvider,
  runsProvider,
  deliverablesProvider,
  draftsProvider,
  onboardingProvider,
  clientJobsProvider,
  documentsProvider,
];
