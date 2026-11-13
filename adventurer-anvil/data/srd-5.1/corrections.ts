// Fixes to the community copy of SRD 5.1, each with its reason. So far these are plain typos, clear without the
// official text; anything less certain is to be checked against the official SRD 5.1 PDF before it goes here.
// The raw files stay unchanged; the importer applies these and lists them in the report.

export interface TextCorrection {
  /** The trait whose text is wrong. */
  trait: string;
  wrong: string;
  right: string;
  reason: string;
}

export const TEXT_CORRECTIONS: TextCorrection[] = [
  {
    trait: "high-elf-cantrip",
    wrong: "of your choice form the wizard spell list",
    right: "of your choice from the wizard spell list",
    reason: "Typo in the community file (\"form\" for \"from\").",
  },
  {
    trait: "brave",
    wrong: "advantage on saving throw against",
    right: "advantage on saving throws against",
    reason: "Typo in the community file (\"saving throw\" for \"saving throws\").",
  },
  {
    trait: "relentless-endurance",
    wrong: "1 hit point instead. you cannot",
    right: "1 hit point instead. You cannot",
    reason: "A sentence starting in lower case in the community file.",
  },
];
