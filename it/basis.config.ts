// The config of `basis lint it`: the folder is the schema's notes, so the schema gives its skip. It imports it by its
// package name, as basis-notes does, so each lint gets one copy of it, with or without the source condition.
import type { Config } from "@mku1tra/basis";
import it from "@mku1tra/it";

export default { schema: it } satisfies Config;
