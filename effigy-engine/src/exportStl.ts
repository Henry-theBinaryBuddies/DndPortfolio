import type { Assets } from "./assets";
import { collectBust } from "./export";
import type { Params } from "./params";
import { PRINT } from "./print";
import type { PrintReport } from "./printable";

// Exporting the bust as an STL: the parts are collected here (it needs the scene's own geometry), merged in a
// worker, and the file is offered for download. A summary says what came out, and what did not.

let worker: Worker | null = null;
let nextId = 1;

export function describe(report: PrintReport): string {
  const lines: string[] = [];
  const overall = report.size[2];
  const bust = overall - PRINT.baseHeight;
  lines.push(`${report.components.length === 1 ? "One solid" : `${report.components.length} separate pieces`}: ${report.size[0].toFixed(0)} x ${report.size[1].toFixed(0)} mm and ${overall.toFixed(0)} mm tall overall (${bust.toFixed(0)} mm bust on a ${PRINT.baseHeight} mm base), ${(report.volume / 1000).toFixed(1)} cm³, ${(report.triangles / 1000).toFixed(0)}k triangles.`);
  const left = report.parts.filter((part) => !part.accepted);
  if (left.length) lines.push(`Left out (not closed solids): ${left.map((part) => `${part.name} (${part.rejectedShells} of ${part.shells}: ${part.problem})`).join("; ")}. This file is incomplete.`);
  if (report.components.length > 1) lines.push(`Pieces of ${report.components.slice(1).map((c) => c.volume.toFixed(1)).join(", ")} mm³ are not joined to the bust.`);
  if (report.specks) lines.push(`${report.specks} stray specks under 0.5 mm³ were removed.`);
  if (report.separated) lines.push(`${report.separated} points where two surfaces touched exactly along an edge were moved a few microns apart.`);
  if (report.badEdges) lines.push(`${report.badEdges} edges of the file are not shared by exactly two triangles.`);
  const [fine, thin] = report.walls.thinner;
  lines.push(`Walls: ${(fine.share * 100).toFixed(1)}% of the surface is thinner than ${fine.limit} mm and ${(thin.share * 100).toFixed(1)}% thinner than ${thin.limit} mm (ear rims, lips, nostrils, hair edges and tips).`);
  if (fine.share > 0.03) lines.push(`That is a lot: the thinnest places are near ${report.walls.worst.slice(0, 2).map((w) => `(${w.at.map((v) => v.toFixed(0)).join(", ")})`).join(" and ")} mm.`);
  if (report.voids) lines.push(`${report.voids} small enclosed pockets inside it.`);
  if (report.status !== "NoError") lines.push(`The merge reported: ${report.status}.`);
  lines.push("The eyes are printed 7% larger than in the preview, so they join the head.");
  return lines.join(" ");
}

// Collects the parts and has the worker merge them. It resolves with the report once the file has been
// offered for download, and rejects on any failure (collecting, the worker dying, the merge refusing), always
// leaving nothing listening and a worker that can be used again. By default a bust that cannot be made into
// exactly one solid is refused; `partial` is the explicit diagnostic export, which keeps what can be merged.
export function exportStl(params: Params, assets: Assets, say: (text: string) => void, partial = false): Promise<PrintReport> {
  const id = nextId++;
  say("Collecting the parts");
  // (a tick to let the message show: collecting the parts is a second or so on the page's own thread)
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      let w: Worker | null = null;
      let onMessage: ((event: MessageEvent) => void) | null = null;
      let onFault: ((event: Event) => void) | null = null;
      const finish = (fault: boolean) => {
        if (w && onMessage) w.removeEventListener("message", onMessage);
        if (w && onFault) {
          w.removeEventListener("error", onFault);
          w.removeEventListener("messageerror", onFault);
        }
        // A worker that has faulted may be in any state: throw it away, and the next export starts a fresh one
        if (fault && w) {
          w.terminate();
          if (worker === w) worker = null;
        }
      };
      const fail = (error: unknown, fault = false) => {
        finish(fault);
        reject(error instanceof Error ? error : new Error(String(error)));
      };
      try {
        worker ??= new Worker(new URL("./exportWorker.ts", import.meta.url), { type: "module" });
        w = worker;
        const { parts, flatCut } = collectBust(params, assets);
        const transfer = parts.flatMap((part) => [part.positions.buffer, part.indices.buffer]);
        onMessage = (event: MessageEvent) => {
          if (event.data.id !== id) return;
          if (event.data.progress) {
            say(`${event.data.progress}…`);
            return;
          }
          if (event.data.error) {
            fail(new Error(event.data.error));
            return;
          }
          try {
            const link = document.createElement("a");
            link.href = URL.createObjectURL(new Blob([event.data.stl], { type: "model/stl" }));
            link.download = `effigy-${params.race}-${params.body}-${params.hairStyle}${partial ? "-partial" : ""}.stl`;
            link.click();
            URL.revokeObjectURL(link.href);
            finish(false);
            resolve(event.data.report as PrintReport);
          } catch (error) {
            fail(error);
          }
        };
        onFault = (event: Event) => fail(new Error((event as ErrorEvent).message || "the export worker stopped unexpectedly"), true);
        w.addEventListener("message", onMessage);
        w.addEventListener("error", onFault);
        w.addEventListener("messageerror", onFault);
        w.postMessage({ id, parts, flatCut, partial }, { transfer });
      } catch (error) {
        fail(error, true);
      }
    }, 30);
  });
}
