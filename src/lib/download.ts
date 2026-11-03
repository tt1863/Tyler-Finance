/** Save text as a file (the browser's download / iOS "Save to Files" sheet). */
export function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** Rows of cells to CSV text. Numbers are written as-is. */
export function toCsv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map((v) => csvCell(String(v))).join(',')).join('\n') + '\n';
}

/** Cents as a plain decimal for spreadsheets: -1234 -> "-12.34". */
export const csvMoney = (cents: number) => (cents / 100).toFixed(2);
