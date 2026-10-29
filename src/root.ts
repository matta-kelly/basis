/**
 * The lint of a root: the one lint basis exports. A root is a folder with its own config, `basis.config.ts` or
 * `basis.config.js`, whose schema names the folder as its notes or its type notes. The caller names the root, and the
 * root decides its graph: its schema gives its ground, its skip, its sources and its imports, and the ground ends at
 * each nested root below it. A folder in a root's ground, the root's own or one below it with no config, is read only
 * as that root's config's schema reads it, also when another schema names it. node_modules is in no graph's ground. No
 * caller chooses a scope, so a graph is linted the same way by each tool that lints it.
 */

import { realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { lintFolder, type LintResult } from "./lint.ts";
import { configFileOf, configNames, inNodeModules } from "./loader.ts";
import { schemasSeen, type AnySchema } from "./primitives.ts";

/** What the config of a root exports by default: only the schema of its graph, which names the root's folder. */
export type Config = { schema: AnySchema };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** What is wrong with a config, if anything. The schema itself is checked by the lint, as every schema is. */
function configProblem(config: unknown): string | undefined {
  if (!isRecord(config))
    return "its default export is not a config: export default { schema }.";
  if (Object.keys(config).some((key) => key !== "schema"))
    return "a config gives only its schema: export default { schema }. Give the skip and sources of the root in its schema's defineSchema.";
  const { schema } = config;
  if (
    !isRecord(schema) ||
    typeof schema.name !== "string" ||
    !isRecord(schema.types) ||
    !Array.isArray(schema.imports)
  )
    return "its schema is not a schema made with defineSchema.";
  return undefined;
}

/** A folder a schema names, as its real path, or undefined when it names none. */
async function namedFolder(url: unknown): Promise<string | undefined> {
  if (!(url instanceof URL) || url.protocol !== "file:") return undefined;
  const path = resolve(fileURLToPath(url));
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}

/** The config of a root: its schema, read from its config file. Throws when the folder is no root. */
async function configOf(folder: string): Promise<Config> {
  const file = configFileOf(folder);
  if (!file)
    throw new Error(
      `${folder} is no root: a lint starts only at a root, a folder with ${configNames.join(" or ")}.`,
    );
  let config: unknown;
  try {
    const module = (await import(pathToFileURL(file).href)) as {
      default?: unknown;
    };
    config = module.default;
  } catch (error) {
    throw new Error(`${file} cannot be loaded: ${String(error)}`, {
      cause: error,
    });
  }
  const problem = configProblem(config);
  if (problem) throw new Error(`${file}: ${problem}`);
  return config as Config;
}

/**
 * The root whose ground holds a folder, by its real path: walking up from the folder, the first folder that holds a
 * config. None when the walk meets none, or when the path has a part named node_modules: node_modules is in no graph's
 * ground, and a config there is never read.
 */
function rootHolding(folder: string): string | undefined {
  if (inNodeModules(folder)) return undefined;
  for (let at = folder; ; at = dirname(at)) {
    if (configFileOf(at)) return at;
    if (dirname(at) === at) return undefined;
  }
}

/**
 * Throws when a schema the lint sees names a folder, as its notes or its type notes, that another root's ground holds:
 * the first folder that holds a config, walking up from it, has a config whose schema is not that schema (the same
 * object). A folder with its own config is a root, read only as its config's schema reads it; a folder with no config
 * in a root's ground is read only as that root's schema reads it. So each lint that reads a folder reads it as its own
 * lint does.
 */
async function groundsHold(schema: AnySchema): Promise<void> {
  for (const owner of schemasSeen(schema))
    for (const [url, as] of [
      [owner.notes, "notes"],
      [owner.typeNotes, "type notes"],
    ] as const) {
      const folder = await namedFolder(url);
      const root = folder && rootHolding(folder);
      if (!root) continue;
      const own = (await configOf(root)).schema;
      if (own === owner) continue;
      throw new Error(
        root === folder
          ? `${folder} holds its own config, so it is read only as its config's schema, ${own.name}, reads it: the schema ${owner.name}, which names it as its ${as}, is another. Import its config's schema, one copy of it, or name another folder.`
          : `${folder} is in the ground of the root ${root}, whose config's schema is ${own.name}: the schema ${owner.name}, which names it as its ${as}, is another, so its notes would be read one way here and another in that root's lint. Name a folder that no other root's ground holds, or give this one a config of its own.`,
      );
    }
}

/**
 * The lint of the root at `folder`: the graph its config's schema makes, from the root's folder, with that schema's
 * skip, sources and imports, to each nested root below. Gives its problems, each by its path from the root, and the
 * graph it checked. Throws when it cannot check: the folder is no root (it is in node_modules, it has no config, its
 * config gives more than its schema, or its schema names the folder as neither its notes nor its type notes), a schema
 * it sees names a folder that a root's ground holds and is not that root's config's schema, or its schema does not
 * hold.
 */
export async function lintRoot(folder: string): Promise<LintResult> {
  const root = resolve(folder);
  const real = await namedFolder(pathToFileURL(root + "/"));
  // Before its config is read: a folder in node_modules is no root, and its config is never read.
  if (real && inNodeModules(real))
    throw new Error(
      `${root} is in node_modules: it is an installed copy, no root, and is linted only through its schema's import. Lint the root that imports it.`,
    );
  const { schema } = await configOf(root);
  const named = [
    await namedFolder(schema.notes),
    await namedFolder(schema.typeNotes),
  ];
  if (!named.includes(real))
    throw new Error(
      `${root} is no root of its schema: a lint starts only at the folder its schema names as its notes or its type notes, and ${schema.name} names ${named.filter(Boolean).join(" and ") || "no folder"}.`,
    );
  let result: LintResult;
  try {
    result = await lintFolder(schema, root);
  } catch (error) {
    throw new Error(`${root} cannot be checked: ${String(error)}`, {
      cause: error,
    });
  }
  // After the lint, which checks each schema it sees first: a schema that does not hold is named as such.
  await groundsHold(schema);
  return result;
}
