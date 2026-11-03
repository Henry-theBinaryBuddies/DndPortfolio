import type { Assets } from "./assets";
import type { Tabletop } from "./fit";
import { copyParts, preparePrint, printSize, type Prepared } from "./printPreview";
import type { Params } from "./params";
import { SQUARE, TABLETOP } from "./print";
import type { PrintReport } from "./printable";

// Exporting the bust as an STL: the parts are collected here (it needs the scene's own geometry), merged in a
// worker, and the file is offered for download. A summary says what came out, and what did not.

let worker: Worker | null = null;
let nextId = 1;

// What came out: the merge's report, which character it was (`made`), how tall the base is where the bust meets it
// (`baseHeight`, mm: measured on the parts, not the nominal height), and for a tabletop print how it was fitted
// (see fit.ts)
export type ExportResult = PrintReport & { made: string; baseHeight: number; tabletop?: Pick<Tabletop, "scale" | "height" | "notes">; warnings?: string[] };

export function describe(report: ExportResult): string {
  const lines: string[] = [];
  const overall = report.size[2];
  // (the bust is measured above its flat cut, where it meets the base, which is not the nominal base height)
  const bust = overall - report.baseHeight;
  lines.push(`Exported ${report.made}. ${report.components.length === 1 ? "One solid" : `${report.components.length} separate pieces`}: ${report.size[0].toFixed(0)} x ${report.size[1].toFixed(0)} mm and ${overall.toFixed(0)} mm tall overall (a ${bust.toFixed(0)} mm bust on a ${report.baseHeight.toFixed(0)} mm base), ${(report.volume / 1000).toFixed(1)} cm³, ${(report.triangles / 1000).toFixed(0)}k triangles.`);
  if (report.tabletop) lines.push(`Tabletop size: the sculpt at ${Math.round(report.tabletop.scale * 100)}% on a ${TABLETOP.base} mm base. ${report.tabletop.notes.join(" ")}`.trim());
  if (report.warnings?.length) lines.push(report.warnings.join(" "));
  const left = report.parts.filter((part) => !part.accepted);
  if (left.length) lines.push(`Left out (not closed solids): ${left.map((part) => `${part.name} (${part.rejectedShells} of ${part.shells}: ${part.problem})`).join("; ")}. This file is incomplete.`);
  if (report.components.length > 1) lines.push(`Pieces of ${report.components.slice(1).map((c) => c.volume.toFixed(1)).join(", ")} mm³ are not joined to the bust.`);
  if (report.specks) lines.push(`${report.specks} stray specks under ${report.speckLimit.toFixed(2)} mm³ were removed (the largest ${report.speckVolumes.map((v) => v.toFixed(3)).join(", ")} mm³).`);
  if (report.separated) lines.push(`${report.separated} points where two surfaces touched exactly along an edge were moved a few microns apart.`);
  if (report.badEdges) lines.push(`${report.badEdges} edges of the file are not shared by exactly two triangles.`);
  const [fine, thin] = report.walls.thinner;
  lines.push(`Walls: ${(fine.share * 100).toFixed(1)}% of the surface is thinner than ${fine.limit} mm and ${(thin.share * 100).toFixed(1)}% thinner than ${thin.limit} mm (ear rims, lips, nostrils, hair edges and tips).`);
  if (report.walls.misses) lines.push(`${report.walls.misses} of ${report.walls.samples} wall measurements found no far side: those shares are of the other ${report.walls.samples - report.walls.misses}, and say nothing of the walls there.`);
  if (fine.share > 0.03) lines.push(`That is a lot: the thinnest places are near ${report.walls.worst.slice(0, 2).map((w) => `(${w.at.map((v) => v.toFixed(0)).join(", ")})`).join(" and ")} mm.`);
  if (report.voids) lines.push(`${report.voids} small enclosed pockets inside it.`);
  if (report.status !== "NoError") lines.push(`The merge reported: ${report.status}.`);
  lines.push("The eyes are printed 7% larger than in the sculpt, so they join the head.");
  return lines.join(" ");
}

// Collects the parts and has the worker merge them. It resolves with the report once the file has been
// offered for download, and rejects on any failure (collecting, the worker dying, the merge refusing), always
// leaving nothing listening and a worker that can be used again. By default a bust that cannot be made into
// exactly one solid is refused; `partial` is the explicit diagnostic export, which keeps what can be merged; `gusset` adds the wedge under the chin, on by default (see gusset.ts); `tabletop` fits the
// bust to a gaming board's one inch square, on by default (see fit.ts). `prepared` is the print as previewed, if it
// was (see printPreview.ts): the file is then made from those very parts.
export function exportStl(params: Params, assets: Assets, say: (text: string) => void, partial = false, gusset = true, tabletop = true, prepared?: Prepared): Promise<ExportResult> {
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
        const ready = prepared ?? preparePrint(params, assets, gusset, tabletop);
        const fitted = ready.tabletop;
        const { base: baseHeight } = printSize(ready.parts, ready.flatCut);
        const parts = copyParts(ready.parts);
        const flatCut = ready.flatCut;
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
            // (the file as merged, measured once more: at tabletop size it must stand inside the one inch square)
            const report = event.data.report as PrintReport;
            const reach = Math.max(...[0, 1].map((k) => Math.max(-report.min[k], report.min[k] + report.size[k])));
            if (fitted && reach > SQUARE / 2) {
              fail(new Error(`The merged file reaches ${reach.toFixed(2)} mm from the middle of its base, past the one inch square; it was not saved`));
              return;
            }
            const link = document.createElement("a");
            link.href = URL.createObjectURL(new Blob([event.data.stl], { type: "model/stl" }));
            link.download = `effigy-${params.race}-${params.body}-${params.hairStyle}${tabletop ? "-tabletop" : ""}${gusset ? "" : "-nogusset"}${partial ? "-partial" : ""}.stl`;
            link.click();
            URL.revokeObjectURL(link.href);
            finish(false);
            resolve({ ...report, made: `${params.race}, ${params.body}, ${params.hairStyle} hair, ${tabletop ? "tabletop size" : "full size"}`, baseHeight, tabletop: fitted ? { scale: fitted.scale, height: fitted.height, notes: fitted.notes } : undefined, warnings: ready.warnings });
          } catch (error) {
            fail(error);
          }
        };
        onFault = (event: Event) => fail(new Error((event as ErrorEvent).message || "the export worker stopped unexpectedly"), true);
        w.addEventListener("message", onMessage);
        w.addEventListener("error", onFault);
        w.addEventListener("messageerror", onFault);
        w.postMessage({ id, parts, flatCut, partial, scale: fitted?.scale ?? 1 }, { transfer });
      } catch (error) {
        fail(error, true);
      }
    }, 30);
  });
}
