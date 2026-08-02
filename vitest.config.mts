import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Le solveur et la machine à états sont du code pur : pas besoin de DOM.
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**", "out/**", "tools/.work/**"],
  },
});
