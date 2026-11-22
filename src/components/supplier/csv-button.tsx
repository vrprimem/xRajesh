"use client";

import { buttonClass } from "@/components/ui";

/** Downloads the given CSV text as a file. The text starts with a byte-order mark so Excel reads it as UTF-8. */
export function CsvButton({ file, csv }: { file: string; csv: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        const url = URL.createObjectURL(new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = file;
        a.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }}
      className={buttonClass("row")}
    >
      Download CSV
    </button>
  );
}
