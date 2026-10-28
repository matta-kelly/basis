// The config of `basis lint it`: the folder is the schema's notes, so the schema gives its skip.
import type { Config } from "@mku1tra/basis";
import it from "./src/schema.ts";

export default { schema: it } satisfies Config;
