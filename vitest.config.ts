import { defineConfig, configDefaults } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    // Match the `@/*` path alias from tsconfig so tests can import like the app.
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    // Sibling Conductor worktrees live under .claude/worktrees and carry their
    // own test files; don't run them as part of this checkout's suite.
    exclude: [...configDefaults.exclude, ".claude/worktrees/**"],
  },
});
