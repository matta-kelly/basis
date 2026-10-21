#!/usr/bin/env node
// The `basis` command: the command line on the process's arguments, from its folder, and its exit code.
import { run } from "./cli.ts";

process.exitCode = await run(process.argv.slice(2), process.cwd(), {
  log: (line) => console.log(line),
  error: (line) => console.error(line),
});
