// A minimal declaration for the one Node API the tests use, so the project does not need @types/node.
declare module "node:fs" {
  export function readFileSync(path: URL): { buffer: ArrayBuffer; byteOffset: number; byteLength: number };
}
