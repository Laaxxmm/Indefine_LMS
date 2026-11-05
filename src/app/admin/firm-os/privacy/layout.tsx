export const dynamic = "force-dynamic";

// /admin/firm-os/privacy stays open while FIRM_OS_ENABLED is off: DPDP data-principal rights and breach
// handling apply to all the firm's client data, not only Firm OS. Access is still admin-only (the
// /admin layout) and each page/route keeps its own policy check.
export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
