import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores(["dist/", "node_modules/", ".wrangler/", "migrations/"]),

  // Base recommended rules for all TS/JS files in src/
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.backend.json", "./tsconfig.web.json", "./tsconfig.test.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Import sorting for all source files
  {
    plugins: { "simple-import-sort": simpleImportSort },
    rules: {
      "simple-import-sort/imports": "error",
      "simple-import-sort/exports": "error",
    },
  },

  // React rules scoped to frontend files
  {
    files: ["src/web/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },

  // Compound component files export multiple components from one file by design,
  // which triggers react-refresh warnings that don't apply here.
  {
    files: [
      "src/web/components/ui/Accordion.tsx",
      "src/web/components/ui/Carousel.tsx",
      "src/web/components/ui/Hero.tsx",
      "src/web/components/ui/MasonryGrid.tsx",
      "src/web/components/ui/MediaCard.tsx",
      "src/web/components/ui/ProgressBar.tsx",
      "src/web/components/ui/Spotlight.tsx",
      "src/web/components/ui/StatCard.tsx",
      "src/web/components/ui/Tabs.tsx",
      "src/web/components/ui/Timeline.tsx",
      "src/web/components/ui/ToastContext.tsx",
    ],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },

  // Root config files — no type-checked rules
  {
    files: ["*.config.{js,ts}"],
    ...tseslint.configs.disableTypeChecked,
  },

  // Prettier last to disable conflicting rules
  prettier,
]);
