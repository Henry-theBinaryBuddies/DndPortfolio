import type { Assets } from "./assets";
import { collectParts } from "./export";
import type { Params } from "./params";
import { PRINT } from "./print";
import type { PrintReport } from "./printable";

// Exporting the bust as an STL: the parts are collected here (it needs the scene's own geometry), merged in a
// worker, and the file is offered for download. A summary says what came out, and what did not.

let worker: Worker | null = null;
let nextId = 1;

export function describe(report: PrintReport): string {
  const lines: string[] = [];
  const bust = report.size[2] - PRINT.baseHeight;
  lines.push(`${report.components.length === 1 ? "One solid" : `${report.components.length} separate pieces`}: ${report.size[0].toFixed(0)} x ${report.size[1].toFixed(0)} mm, ${bust.toFixed(0)} mm bust on a ${PRINT.baseHeight} mm base, ${(report.volume / 1000).toFixed(1)} cm³, ${(report.triangles / 1000).toFixed(0)}k triangles.`);
  const left = report.parts.filter((part) => !part.accepted);
  if (left.length) lines.push(`Left out (not closed solids): ${left.map((part) => `${part.name} (${part.rejectedShells} of ${part.shells}: ${part.problem})`).join("; ")}.`);
  if (report.components.length > 1) lines.push(`Pieces of ${report.components.slice(1).map((c) => c.volume.toFixed(1)).join(", ")} mm³ are not joined to the bust.`);
  if (report.voids) lines.push(`${report.voids} small enclosed pockets inside it.`);
  if (report.status !== "NoError") lines.push(`The merge reported: ${report.status}.`);
  return lines.join(" ");
}

export function exportStl(params: Params, assets: Assets, say: (text: string) => void): Promise<PrintReport> {
  worker ??= new Worker(new URL("./exportWorker.ts", import.meta.url), { type: "module" });
  const id = nextId++;
  say("Collecting the parts");
  // (a tick to let the message show: collecting the parts is a second or so on the page's own thread)
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      const parts = collectParts(params, assets);
      const transfer = parts.flatMap((part) => [part.positions.buffer, part.indices.buffer]);
      const w = worker!;
      const done = (event: MessageEvent) => {
        if (event.data.id !== id) return;
        if (event.data.progress) {
          say(`${event.data.progress}…`);
          return;
        }
        w.removeEventListener("message", done);
        if (event.data.error) {
          reject(new Error(event.data.error));
          return;
        }
        const name = `effigy-${params.race}-${params.body}-${params.hairStyle}.stl`;
        const link = document.createElement("a");
        link.href = URL.createObjectURL(new Blob([event.data.stl], { type: "model/stl" }));
        link.download = name;
        link.click();
        URL.revokeObjectURL(link.href);
        resolve(event.data.report as PrintReport);
      };
      w.addEventListener("message", done);
      w.postMessage({ id, parts }, { transfer });
    }, 30);
  });
}
