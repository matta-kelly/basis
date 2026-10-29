/**
 * basis-notes: the notes that explain basis (basis.md, its basis-*.md notes), as a graph of their own. Its notes are
 * the repo's root, this package's parent folder. It imports it for the note types the notes use, so it's notes and
 * type notes are read once, as it's. basis's type notes in types/ are the built-in schema's, which every schema sees.
 * A private package of the repo, never published: the repo's root lints from it, and a graph above imports it as a
 * workspace. Its peers are the importer's basis and it, one instance of each.
 */

import { defineSchema } from "@mku1tra/basis";
import it from "@mku1tra/it";

const notes = defineSchema({
  name: "basis-notes",
  description: "The notes that explain basis, on the note types of it.",
  types: {},
  imports: [it],
  notes: new URL("../", import.meta.url),
  // Not a note: the README npm and GitHub show (Reality, with no frontmatter). basis never reads node_modules.
  skip: (path) => path === "README.md",
});

export default notes;
