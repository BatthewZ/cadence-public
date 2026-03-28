import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const sharedResolve = {
  alias: { "@": path.resolve(__dirname, "./src") },
};

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [react()],
        test: {
          name: "web",
          include: ["src/web/**/*.test.{ts,tsx}"],
          environment: "jsdom",
          setupFiles: ["src/web/test-setup.ts"],
        },
        resolve: sharedResolve,
      },
      {
        test: {
          name: "api",
          include: ["src/api/**/*.test.ts"],
          environment: "node",
        },
        resolve: sharedResolve,
      },
      {
        test: {
          name: "unit",
          include: ["src/shared/**/*.test.ts"],
          environment: "node",
        },
        resolve: sharedResolve,
      },
    ],
  },
});
