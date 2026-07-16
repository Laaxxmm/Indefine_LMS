import { TaxTool } from "../_components/TaxTool";

export default function TdsChallanPage() {
  return (
    <TaxTool
      tool="tds-challan"
      title="TDS Challan Processor"
      subtitle="Upload TDS challan PDFs and extract them into an Excel sheet with a nature-of-payment pivot summary."
    />
  );
}
