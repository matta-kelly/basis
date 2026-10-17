/**
 * The lint: notes and a package in, problems out. It changes nothing.
 */

import type { Note, Problem } from "./loader.ts";
import type { Package } from "./primitives.ts";

/** What is wrong with the notes, by the package. */
export function lint(pkg: Package, notes: Note[]): Problem[] {
  throw new Error(`not built: ${pkg.name} ${String(notes.length)}`);
}

/** A folder, loaded and linted: the loader's problems and the lint's, in path order. */
export function lintFolder(pkg: Package, folder: string): Promise<Problem[]> {
  throw new Error(`not built: ${pkg.name} ${folder}`);
}
