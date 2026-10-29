// The config of `basis lint .`: the repo's root, whose notes are basis-notes's. The schema gives its skip.
import type { Config } from "@mku1tra/basis";
import notes from "./basis-notes/schema.ts";

export default { schema: notes } satisfies Config;
