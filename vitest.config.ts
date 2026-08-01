import { defineConfig } from "vitest/config";

// reflect-metadata must load before any @Injectable() class module is imported,
// otherwise the decorator's Reflect.defineMetadata call throws at definition time.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.spec.ts"],
    setupFiles: ["reflect-metadata"],
  },
});
