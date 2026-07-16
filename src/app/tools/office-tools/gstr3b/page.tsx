import { TaxTool } from "../_components/TaxTool";

export default function Gstr3bPage() {
  return (
    <TaxTool
      tool="gstr3b"
      title="GSTR-3B Processor"
      subtitle="Upload one or more GSTR-3B return PDFs and extract the figures into a consolidated Excel workbook."
    />
  );
}
