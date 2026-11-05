// Production wiring for the onboarding service: Prisma, the ModelRouter, the active Turia bridge,
// SharePoint Path A and the statutory calendar. Routes call onboardingService(); tests build the
// service with createOnboardingService() and fakes instead.
import { prisma } from "@/lib/prisma";
import { run } from "@/lib/ai/router";
import { defaultClFolders } from "@/lib/integrations/sharepoint/clfolders";
import { listTuriaSyncs, prismaTuriaSyncRepo } from "@/lib/integrations/turia/db";
import { createTuriaAdapter, manualBridge, turiaBridgeMode } from "@/lib/integrations/turia/factory";
import { listPeople, loadCalendarPack, prismaRunStore, prismaSagaStore, prismaValidationPorts, setTuriaClientRef } from "./db";
import { isConfirmRequired } from "./plan";
import { createCalendarPlanner } from "./planner";
import { isOnboardingAiRestricted, type OnboardingRestrictionDb } from "./restriction";
import { createSaga } from "./saga";
import { createOnboardingService, type OnboardingService } from "./service";

export function onboardingService(opts: { actorIsPartner?: boolean } = {}): OnboardingService {
  const repo = prismaTuriaSyncRepo(prisma);
  const turia = createTuriaAdapter({ repo, actorIsPartner: opts.actorIsPartner });
  const store = prismaSagaStore(prisma);
  return createOnboardingService({
    runs: prismaRunStore(prisma),
    router: { run },
    people: () => listPeople(prisma),
    ports: prismaValidationPorts(prisma, turia),
    planner: createCalendarPlanner({ loadPack: () => loadCalendarPack(prisma) }),
    // SharePoint is built lazily: a missing PnP certificate becomes a BLOCKED step, not a crash.
    saga: createSaga({
      store,
      turia,
      sharepoint: {
        ensureClientSite: (code) => defaultClFolders().ensureClientSite(code),
        ensureFyTree: (code, fy, o) => defaultClFolders().ensureFyTree(code, fy, o),
      },
    }),
    turiaMode: turiaBridgeMode(),
    confirmRequired: isConfirmRequired(),
    manual: manualBridge(repo),
    listTuriaSyncs: (firmClientId) => listTuriaSyncs(prisma, firmClientId),
    getTuriaSync: (id) => repo.get(id),
    setTuriaClientRef: (firmClientId, ref) => setTuriaClientRef(prisma, firmClientId, ref),
    audit: (e) => store.audit(e),
    aiRestricted: (subject) => isOnboardingAiRestricted(prisma as unknown as OnboardingRestrictionDb, subject),
  });
}
