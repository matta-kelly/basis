/**
 * The command line: `basis lint [root]` lints the graph of a root, as `lintRoot` does, and gives a line for each
 * problem, by its path from the folder it runs in. A root is a folder with its own config, `basis.config.ts` or
 * `basis.config.js`, whose schema names the folder as its notes or its type notes. A person, a hook and a pipeline run
 * the same command, so a graph is checked the same way in each.
 */

import { join, relative, resolve } from "node:path";
import { lintRoot } from "./root.ts";

/** Where the command writes: a line of its output, and a line of an error. */
export type Out = {
  log: (line: string) => void;
  error: (line: string) => void;
};

const usage = "Usage: basis lint [root]";

/**
 * The command, on its arguments, from a folder. Gives the exit code: 0 when the nodes have no problem, 1 when they
 * have one, and 2 when the command cannot check them (a wrong command, a folder that is no root, a schema that does not
 * hold).
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
  const [command, rootArg, ...rest] = args;
  if (command !== "lint" || rest.length > 0) {
    out.error(usage);
    return 2;
  }
  const root = resolve(cwd, rootArg ?? ".");
  let problems;
  try {
    ({ problems } = await lintRoot(root));
  } catch (error) {
    out.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
  // A path from the folder the command runs in, so a shell, an editor and a pipeline open it as given.
  for (const problem of problems)
    out.log(
      `${relative(cwd, join(root, problem.path))}:${problem.field ? ` ${problem.field}:` : ""} ${problem.message}${problem.rule ? ` (${problem.rule})` : ""}`,
    );
  return problems.length > 0 ? 1 : 0;
}
