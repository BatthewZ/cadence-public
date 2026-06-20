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
        projectService: true,
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

  // Compound component files export multiple components from one file by design
  // (e.g. `Object.assign(Root, { Trigger, Content })`). Fast Refresh can't statically
  // recognise that namespaced shape as a component, so the rule flags every
  // sub-component. Splitting them would break the compound API (`Popover.Trigger`),
  // so the rule is disabled here. Fast Refresh is a dev-only HMR optimisation with
  // no production impact.
  {
    files: [
      "src/web/components/ui/Accordion.tsx",
      "src/web/components/ui/AppShell.tsx",
      "src/web/components/ui/Breadcrumbs.tsx",
      "src/web/components/ui/Carousel.tsx",
      "src/web/components/ui/DropdownMenu.tsx",
      "src/web/components/ui/Hero.tsx",
      "src/web/components/ui/MasonryGrid.tsx",
      "src/web/components/ui/MediaCard.tsx",
      "src/web/components/ui/Popover.tsx",
      "src/web/components/ui/ProgressBar.tsx",
      "src/web/components/ui/Spotlight.tsx",
      "src/web/components/ui/StatCard.tsx",
      "src/web/components/ui/Table.tsx",
      "src/web/components/ui/Tabs.tsx",
      "src/web/components/ui/Timeline.tsx",
      "src/web/components/ui/ToastContext.tsx",
    ],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
  {
    files: ["src/web/contexts/ProjectContext.tsx", "src/web/contexts/ThemeControlContext.tsx"],
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
