// Where the site's own files are (the models and the backdrops). The build's base is "./" (see vite.config.ts), so the
// site works from any folder, which makes these relative addresses: the page resolves them against its own address,
// but a worker resolves them against its script's, in assets/, where there are none, and the server answers with the
// page itself (the print worker read "<!do" as the head's vertex count). So the page's address is used everywhere,
// and a worker that loads files is told it with each request (see prepareClient.ts).

let base = typeof document === "undefined" ? import.meta.env.BASE_URL : new URL(import.meta.env.BASE_URL, document.baseURI).href;

export function siteUrl(path: string): string {
  return `${base}${path}`;
}

// The page's base address, to send to a worker; and, in the worker, to use it
export function siteBase(): string {
  return base;
}
export function useSiteBase(href: string) {
  base = href;
}
