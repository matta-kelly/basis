import { defaultServerConditions } from "vite";
import { defineConfig } from "vitest/config";

// The tests run basis as it is, as tsc and the repo's lint do: the export condition @mku1tra/source picks src/, so a
// config that imports @mku1tra/basis gets the same schemas as the tests, not a copy from dist/.
export default defineConfig({
  ssr: {
    resolve: { conditions: ["@mku1tra/source", ...defaultServerConditions] },
  },
  test: { globalSetup: ["fixtures/setup.ts"] },
});
