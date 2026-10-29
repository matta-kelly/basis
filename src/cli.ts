/**
 * The command line: `basis lint [folder]` checks the notes of a folder, and the pieces of each source its config names, against the schema it names, and
 * gives a line for each problem, by its path from the folder it runs in. The config is `basis.config.ts`, or `basis.config.js`, at the root of the folder.
 * A person, a hook and a pipeline run the same command, so a folder is checked the same way in each.
 */

import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { lintFolder } from "./lint.ts";
import { configFileOf, configNames, type Source } from "./loader.ts";
import type { AnySchema } from "./primitives.ts";

/** What the config of a folder exports by default: the schema its nodes are checked against, what is not a note, and where more pieces come from. */
export type Config = {
  schema: AnySchema;
  /**
   * The paths that are not notes, from the folder, with `/` between parts. A path leaves out itself and all in it.
   * Or a function, as `lintFolder` takes it.
   */
  skip?: readonly string[] | ((path: string) => boolean);
  /** The sources of pieces beside the folder's notes, as `lintFolder` takes them. */
  sources?: readonly Source[];
};

/** Where the command writes: a line of its output, and a line of an error. */
export type Out = {
  log: (line: string) => void;
  error: (line: string) => void;
};

const usage = "Usage: basis lint [folder]";

// A skip path as the loader gives paths: no leading "./" and no trailing "/".
const pathOf = (skip: string) =>
  skip.replace(/^(\.\/)+/, "").replace(/\/+$/, "");

/** A config's skip, as `lintFolder` takes it. */
const skipOf = (skip: Config["skip"]) => {
  if (typeof skip === "function" || skip === undefined) return skip;
  const paths = skip.map(pathOf);
  return (path: string) =>
    paths.some((s) => path === s || path.startsWith(`${s}/`));
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** What is wrong with a config, if anything. The schema itself is checked by the lint, as every schema is. */
function configProblem(config: unknown): string | undefined {
  if (!isRecord(config))
    return "its default export is not a config: export default { schema, skip, sources }.";
  const { schema, skip, sources } = config;
  if (
    !isRecord(schema) ||
    typeof schema.name !== "string" ||
    !isRecord(schema.types) ||
    !Array.isArray(schema.imports)
  )
    return "its schema is not a schema made with defineSchema.";
  const isPaths =
    Array.isArray(skip) && skip.every((path) => typeof path === "string");
  if (skip !== undefined && typeof skip !== "function" && !isPaths)
    return "its skip is not a list of paths or a function.";
  if (
    sources !== undefined &&
    !(
      Array.isArray(sources) &&
      sources.every((source) => typeof source === "function")
    )
  )
    return "its sources are not a list of functions.";
  return undefined;
}

/** The config of a folder, or what keeps it from being read. */
async function configOf(
  folder: string,
): Promise<{ ok: true; config: Config } | { ok: false; message: string }> {
  const file = configFileOf(folder);
  if (!file)
    return {
      ok: false,
      message: `${folder} has no config: basis lint reads ${configNames.join(" or ")}.`,
    };
  let config: unknown;
  try {
    const module = (await import(pathToFileURL(file).href)) as {
      default?: unknown;
    };
    config = module.default;
  } catch (error) {
    return { ok: false, message: `${file} cannot be loaded: ${String(error)}` };
  }
  const problem = configProblem(config);
  if (problem) return { ok: false, message: `${file}: ${problem}` };
  return { ok: true, config: config as Config };
}

/**
 * The command, on its arguments, from a folder. Gives the exit code: 0 when the nodes have no problem, 1 when they
 * have one, and 2 when the command cannot check them (a wrong command, no config, a schema that does not hold).
 */
export async function run(
  args: readonly string[],
  cwd: string,
  out: Out,
): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    out.log(usage);
    return 0;
  }
  const [command, folderArg, ...rest] = args;
  if (command !== "lint" || rest.length > 0) {
    out.error(usage);
    return 2;
  }
  const folder = resolve(cwd, folderArg ?? ".");
  const read = await configOf(folder);
  if (!read.ok) {
    out.error(read.message);
    return 2;
  }
  const skip = skipOf(read.config.skip);
  const { sources } = read.config;
  let problems;
  try {
    ({ problems } = await lintFolder(read.config.schema, folder, {
      ...(skip && { skip }),
      ...(sources && { sources }),
    }));
  } catch (error) {
    out.error(`${folder} cannot be checked: ${String(error)}`);
    return 2;
  }
  // A path from the folder the command runs in, so a shell, an editor and a pipeline open it as given.
  for (const problem of problems)
    out.log(
      `${relative(cwd, join(folder, problem.path))}:${problem.field ? ` ${problem.field}:` : ""} ${problem.message}${problem.rule ? ` (${problem.rule})` : ""}`,
    );
  return problems.length > 0 ? 1 : 0;
}
