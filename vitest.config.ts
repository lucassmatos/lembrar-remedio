import { defineConfig, configDefaults } from "vitest/config";

export default defineConfig({
  test: {
    // Sibling Conductor worktrees live under .claude/worktrees and carry their
    // own test files; don't run them as part of this checkout's suite.
    exclude: [...configDefaults.exclude, ".claude/worktrees/**"],
  },
});
