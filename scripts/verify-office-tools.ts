// Runtime smoke test for the Office Tools generators — exercises the docx renderers,
// the exceljs workbook path, and the TDS challan parser+pivot. Run: npx tsx scripts/verify-office-tools.ts
import { renderRentalDocx } from "../src/lib/office-tools/tools/rental";
import { renderMouDocx } from "../src/lib/office-tools/tools/mou";
import { renderPartnershipDocx } from "../src/lib/office-tools/tools/partnership";
import { renderTrustDocx } from "../src/lib/office-tools/tools/trust";
import { renderLlpDocx } from "../src/lib/office-tools/tools/llp";
import { buildTdsWorkbook } from "../src/lib/office-tools/tools/tdsChallan";

let failed = 0;
const check = (name: string, buf: Buffer, min = 1000) => {
  const ok = buf && buf.length > min;
  console.log(`${ok ? "✓" : "✗"} ${name} — ${buf?.length ?? 0} bytes`);
  if (!ok) failed++;
};

async function main() {
  check("rental", await renderRentalDocx({
    place: "Bangalore", agreementDate: "2026-07-16", premisesType: "Commercial", businessName: "GLAMOR ENTERPRISE",
    ownerName: "PRADEEP T N", ownerFather: "Nataraj", ownerAadhaar: "1234 5678 9012", ownerAddress: "Site 76, Bangalore",
    tenantName: "DANISH MALIK", tenantFather: "Usman", tenantAadhaar: "9876 5432 1098", tenantAddress: "Ghaziabad UP",
    securityDeposit: 100000, rent: 10000, paymentMethod: "Cash", otherChargesTitle: "water and electricity",
    otherCharges: "Tenant pays electricity.", startDate: "2026-08-01", durationMonths: 11, renewalIncrease: 5,
    natureUse: "The Schedule Property shall be used for Commercial Purpose Only in the name of “GLAMOR ENTERPRISE”.",
    maintenance: "Tenant maintains premises.", scheduleAddress: "Site 76, Bangalore", facilities: "water and electrical facility",
  }));

  check("mou", await renderMouDocx({
    agreementDate: "2026-07-16", party1Name: "Company A", party1Address: "Addr A", party1Short: "First Party",
    party2Name: "Company B", party2Address: "Addr B", party2Short: "Second Party", projectTitle: "Project X",
    objectives: "Obj 1\nObj 2", businessType: "business", scopeParty1: "Scope A1\nScope A2", scopeParty2: "Scope B1",
    rolesParty1: "Role A1", rolesParty2: "Role B1", governanceCompany: "Company A", ipOwner: "First Party",
    commercializationParty: "Second Party", validityYears: 3, courtLocation: "Bangalore",
    sig1Name: "Alice", sig1Designation: "Director", sig1AuthDoc: "Board Res 1", sig1AuthDate: "2026-01-01",
    sig2Name: "Bob", sig2Designation: "Director", sig2AuthDoc: "Board Res 2", sig2AuthDate: "2026-01-02",
    witness1Name: "W1", witness1Address: "WA1", witness2Name: "W2", witness2Address: "WA2",
  }));

  check("partnership", await renderPartnershipDocx({
    dateExecution: "2026-07-16", businessType: "Trading", shortObjects: "trading of goods.",
    businessActivity: "The partnership shall trade goods.", partnershipName: "ACME TRADERS", placeBusiness: "Bangalore",
    partners: [
      { name: "Alice", aadhaar: "123456789012", pan: "ABCDE1234F", age: 35, relationType: "s/o", relationName: "X", address: "Addr1", capital: 50000, profitShare: 50 },
      { name: "Bob", aadhaar: "210987654321", pan: "PQRST5678G", age: 40, relationType: "s/o", relationName: "Y", address: "Addr2", capital: 50000, profitShare: 50 },
    ],
    remuneration: 25000, drawingsLimit: "5,00,000", managingPartnerIdx: 0, bankOperatorIdx: 1,
    witness1Name: "W1", witness1Address: "WA1", witness2Name: "W2", witness2Address: "WA2",
  }));

  check("trust", await renderTrustDocx({
    dateExecution: "2026-07-16", shortObjects: "advance education.", detailedObjects: "a. Point one\nb. Point two",
    amountDeclared: 500, trustName: "Vision Foundation", trustAddress: "Bangalore",
    parties: [
      { name: "Alice", aadhaar: "123456789012", pan: "ABCDE1234F", age: 40, address: "Addr1", designation: "Author" },
      { name: "Bob", aadhaar: "210987654321", pan: "PQRST5678G", age: 45, address: "Addr2", designation: "Trustee" },
    ],
    boardTrustees: "Alice, Author\nBob, Trustee", officers: "Author\nTrustee",
    signatures: "Alice\nAuthor\nPAN: ABCDE1234F\nAADHAAR: 123456789012", witnesses: "1. W1\nWA1\n99999\n\n2. W2\nWA2\n88888",
  }));

  check("llp", await renderLlpDocx({
    llpType: "Reconstitution", llpName: "MUSAFIR BIRYANI LLP", state: "Assam", businessType: "Trading",
    partners: [
      { name: "Mr. Alice", gender: "Son", father: "X", age: 35, pan: "ABCDE1234F", din: "00012345", address: "Addr1", role: "Continuing", contribution: 50000, profitShare: 34 },
      { name: "Mr. Bob", gender: "Son", father: "Y", age: 40, pan: "PQRST5678G", din: "00067890", address: "Addr2", role: "New", contribution: 30000, profitShare: 33 },
      { name: "Mr. Carol", gender: "Daughter", father: "Z", age: 30, pan: "LMNOP9012H", din: "N/A", address: "Addr3", role: "Resigning", contribution: 20000, profitShare: 33 },
    ],
  }));

  // TDS challan: craft a synthetic challan text and exercise parse + pivot + exceljs.
  const challan = [
    "ITNS No. : 281",
    "TAN : BLRA12345E",
    "Name : ACME PRIVATE LIMITED",
    "Assessment Year : 2024-25",
    "Financial Year : 2023-24",
    "Major Head : 0021 Income Tax",
    "Minor Head : 200 TDS Payable",
    "Nature of Payment : 94C",
    "Amount (in Rs.) : ₹ 1,00,000",
    "CIN : 24BLRA123456",
    "Mode of Payment : Net Banking",
    "Bank Name : HDFC Bank",
    "Bank Reference Number : 1234567890",
    "Date of Deposit : 05-Apr-2024",
    "BSR code : 0510308",
    "Challan No : 05123",
    "Tender Date : 05-Apr-2024",
    "Tax Breakup Details",
    "Tax ₹ 90,000",
    "Surcharge ₹ 0",
    "Cess ₹ 0",
    "Interest ₹ 0",
    "Penalty ₹ 0",
    "Fee under section 234E ₹ 0",
  ].join(" ");
  const tds = await buildTdsWorkbook([{ name: "challan1.pdf", buffer: Buffer.from("") }], async () => challan);
  check("tds-challan (parse+pivot+xlsx)", tds.bytes, 3000);

  console.log(failed === 0 ? "\nAll office-tools generators OK." : `\n${failed} check(s) FAILED.`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
