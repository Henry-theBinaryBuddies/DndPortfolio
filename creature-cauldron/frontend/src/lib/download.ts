/**
 * Saves text as a file on the user's computer. A static site has no server to send a file, so the
 * browser builds one in memory (a Blob), gets a temporary address for it, and "clicks" a hidden
 * download link. This is the one impure function in the export code.
 */
export function downloadTextFile(filename: string, text: string, mimeType = "application/json"): void {
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
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
