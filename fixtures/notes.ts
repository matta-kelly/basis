// The notes the tests read from disk, by path from the folder of fixtures. Some are wrong on purpose, so the repo holds
// none of them: setup.ts writes them into a temporary folder before the tests, and removes it after.
import { pathToFileURL } from "node:url";
import { inject } from "vitest";

export const notes: Record<string, string> = {
  // The folder linted: loaf.md, right, links to oven.md, which cannot be read; bun.md links to no note; do-bake.md is of
  // a type things does not have; and scone.md has no key.
  "lint/bun.md":
    '---\ntype: object\ndescription: Lives nowhere.\nkey: bun_code\nlivesIn:\n  - "[[nowhere]]"\nstates:\n  - drafted\n---\n\n',
  "lint/daybook.md":
    "---\ntype: source\ndescription: The record of what exists.\nrole: record\n---\n\n",
  "lint/do-bake.md":
    "---\ntype: verb\ndescription: A type the schema does not have.\n---\n\n",
  "lint/loaf.md":
    '---\ntype: object\ndescription: One bake of one dough.\nkey: loaf_code\nlivesIn:\n  - "[[slate]]"\n  - "[[daybook]]"\n  - "[[oven]]"\nstates:\n  - drafted\n  - complete\nrepresentedAs:\n  - "[[till-item]]"\n---\n\n',
  "lint/oven.md": "---\ntype: [unclosed\n---\n",
  "lint/scone.md":
    '---\ntype: object\ndescription: Missing its key.\nlivesIn:\n  - "[[slate]]"\nstates:\n  - drafted\n---\n\n',
  "lint/slate.md":
    "---\ntype: source\ndescription: Where recipes are written.\nrole: entry\n---\n\n",
  "lint/till-item.md":
    '---\ntype: external-object\ndescription: A loaf as the till holds it.\nheldIn: "[[till]]"\n---\n\n',
  "lint/till.md":
    "---\ntype: source\ndescription: The shop's till.\nrole: projection\n---\n\n",
  // The folder loaded: notes it reads, notes it cannot read, a file and a folder it leaves out, and a file that is not
  // a note.
  "loader/.draft.md": "---\ntype: x\n---\n",
  "loader/.hidden/hidden.md": "---\ntype: x\n---\n",
  "loader/broken.md": "---\ntype: object\nlivesIn: [unclosed\n---\n",
  "loader/empty.md": "---\n---\nAn empty frontmatter.\n",
  "loader/list.md": "---\n- a\n- b\n---\n",
  "loader/loaf.md":
    '---\ntype: object\ndescription: "One bake of one dough. A crust."\nkey: loaf_code\nlivesIn: ["[[slate]]", "[[daybook]]"]\nstates: [drafted, complete, synced, stale]\n---\nOne bake of one dough.\n',
  "loader/notes.txt": "not a note\n",
  "loader/plain.md": "Just text, no frontmatter.\n",
  "loader/sources/slate.md":
    '---\ntype: source\ndescription: "Where recipes are written."\nrole: entry\n---\nWhere recipes are written.\n',
  "loader/unclosed.md": "---\ntype: object\nNo closing line.\n",
  // The type notes of core and of things, each right.
  "types/core/agent.md":
    "---\ntype: type\n---\nOne agent of a deployment, and its role.\n",
  "types/core/capability.md":
    "---\ntype: type\n---\nAn outcome someone wants from a system.\n",
  "types/core/case.md":
    "---\ntype: type\n---\nOne behaviour of one capability.\n",
  "types/things/external-object.md":
    "---\ntype: type\n---\nAn outside copy of an object. It links to the source that holds it.\n",
  "types/things/object.md":
    "---\ntype: type\n---\nWhat the business is made of, and the sources that hold it.\n",
  "types/things/source.md":
    "---\ntype: type\n---\nA place data lives: a database, a file, an app.\n",
  // The type notes of kitchen, wrong on purpose: kitchen.ts says how.
  "types/kitchen/crumb.md":
    '---\ntype: type\ndescription: "Its frontmatter has no closing line."\n',
  "types/kitchen/loaf.md":
    '---\ntype: type\ndescription: "A big bread."\n---\nIts note gives a description, which its code gives.\n',
  "types/kitchen/oven.md":
    "---\ntype: type\n---\nWhere a bake is made. Its type is abstract, which its code says, not its note.\n",
  "types/kitchen/roll.md": "---\ntype: type\n---\nA small bread.\n",
  "types/kitchen/scone.md":
    "---\ntype: type\nabstract: true\n---\nIts note gives abstract, which its code gives.\n",
  "types/kitchen/till.md":
    '---\ntype: type\ndescription: "The shop\'s till."\n---\nA type note of a type the schema does not have.\n',
  "types/kitchen/tray.md":
    "---\ntype: type\n---\nWhat a bake sits on. A note is of a type that inherits it.\n",
};

/** A path in the folder of fixtures, as a file URL: a folder when the path ends in `/`. */
export const fixture = (path: string): URL =>
  new URL(path, pathToFileURL(`${inject("fixtures")}/`));
