import { exportFileName, toJsonText } from "./exportCommon";

/**
 * Saves text as a file on the user's computer. A static site has no server to send a file, so the
 * browser builds one in memory (a Blob), gets a temporary address for it, and "clicks" a hidden
 * download link. This is the one impure function in the export code.
 */
export function downloadTextFile(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  // Some browsers only honour a click on a link that is on the page.
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser time to start the download before the temporary address is released.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Names a file (`<prefix>-<name>.json`), saves `value` into it as JSON text, and returns the file's name for the status line. */
export function downloadJson(prefix: string, name: string, value: unknown): string {
  const filename = exportFileName(prefix, name);
  downloadTextFile(filename, toJsonText(value));
  return filename;
}
