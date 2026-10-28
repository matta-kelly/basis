// Runs on every new note (Templater folder template on "/"). Asks for the note's type and description, and returns
// its frontmatter and its starting body for Templater to write in one go. The types are the type notes in the vault;
// each package's schema defines their fields, and `just lint` says which are still to fill.

// Folders whose notes are not the vault's own: installed packages, and test fixtures, which hold type notes that are
// wrong on purpose. By name, wherever they are, as lot's lint config skips them.
const notNotes = new Set(["node_modules", "fixtures"]);
// The body of a note whose type note has none: this package's templater/note.md, wherever the package is.
const defaultTemplate = "it/templater/note.md";

async function new_note(tp) {
  const file = tp.config.target_file;
  if (app.metadataCache.getFileCache(file)?.frontmatter?.type) return ""; // already typed

  const types = typeNotes();
  const type = await tp.system.suggester(
    types.map((note) => note.basename),
    types,
    true,
    "Type?",
  );
  let description = "";
  while (!description.trim())
    description = await tp.system.prompt("Description (required)", "", true);

  // Returned, not written: Templater merges this frontmatter into the note and appends the body in one write.
  // Writing the file here too would race Templater's own write and lose one of them.
  const fm = tp.obsidian.stringifyYaml({ type: type.basename, description });
  return `---\n${fm}---\n${await body(type)}`;
}

// The type notes, by name: each note of type `type`, wherever its schema keeps it. A type note gives only prose, so
// an abstract type is offered too; the lint fails a note of one (basis/type).
function typeNotes() {
  return app.vault
    .getMarkdownFiles()
    .filter(
      (note) =>
        !note.path.split("/").some((part) => notNotes.has(part)) &&
        app.metadataCache.getFileCache(note)?.frontmatter?.type === "type",
    )
    .sort((a, b) => a.basename.localeCompare(b.basename));
}

// The type note's body, or the default template when it has none.
async function body(typeNote) {
  const strip = (text) => text.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
  const own = strip(await app.vault.cachedRead(typeNote));
  if (own) return own;
  const fallback = app.vault
    .getMarkdownFiles()
    .find(
      (note) =>
        note.path === defaultTemplate ||
        note.path.endsWith(`/${defaultTemplate}`),
    );
  return fallback ? strip(await app.vault.cachedRead(fallback)) : "";
}

module.exports = new_note;
