"use client";

export default function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="text-sm px-3 py-1.5 rounded bg-white/10 hover:bg-white/15"
    >
      Print / save as PDF
    </button>
  );
}
