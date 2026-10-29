// Vitest's global setup: it writes the notes of notes.ts into a new temporary folder, gives its path to the tests as
// "fixtures", and removes the folder after the tests.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { TestProject } from "vitest/node";
import { notes } from "./notes.ts";

declare module "vitest" {
  export interface ProvidedContext {
    fixtures: string;
  }
}

export default async function setup(project: TestProject) {
  const root = await mkdtemp(join(tmpdir(), "basis-fixtures-"));
  for (const [path, text] of Object.entries(notes)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  project.provide("fixtures", root);
  return () => rm(root, { recursive: true, force: true });
}
