import { Clipboard, Download, Pipette, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Select } from "@/web/components/form";
import { Container, Row, Stack } from "@/web/components/layout";
import {
  Badge,
  Button,
  Card,
  IconButton,
  Tabs,
  Text,
  useToast,
} from "@/web/components/ui";
import { useDocumentTitle } from "@/web/hooks/use-document-title";
import { THEMES } from "@/web/hooks/use-theme";

import { snapshotAll } from "./components/helpers";
import { LivePreview } from "./components/LivePreview";
import type { TokenDef } from "./components/token-constants";
import { ALL_TOKENS, TAB_CONFIG } from "./components/token-constants";
import { TokenGroupSection } from "./components/TokenInputs";

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

export function ThemeEditor() {
  useDocumentTitle("Theme Editor");
  const { toast } = useToast();

  // Track which theme was active on mount so we can restore it on leave
  const originalThemeAttr = useRef(
    document.documentElement.getAttribute("data-theme")
  );
  // Snapshot the initial computed values before any user overrides
  const baselineRef = useRef<Record<string, string>>(snapshotAll());

  const [overrides, setOverrides] = useState<Record<string, string>>(() => snapshotAll());
  const [changedKeys, setChangedKeys] = useState<Set<string>>(new Set());

  // Clean up inline overrides on unmount
  useEffect(() => {
    const savedAttr = originalThemeAttr.current;
    return () => {
      for (const token of ALL_TOKENS) {
        document.documentElement.style.removeProperty(token.variable);
      }
      // Restore original theme attribute
      if (savedAttr) {
        document.documentElement.setAttribute("data-theme", savedAttr);
      } else {
        document.documentElement.removeAttribute("data-theme");
      }
    };
  }, []);

  const handleChange = useCallback((variable: string, value: string) => {
    setOverrides((prev) => ({ ...prev, [variable]: value }));
    setChangedKeys((prev) => new Set(prev).add(variable));
    document.documentElement.style.setProperty(variable, value);
  }, []);

  const handleLoadTheme = useCallback((themeName: string) => {
    // Clear all inline overrides first
    for (const token of ALL_TOKENS) {
      document.documentElement.style.removeProperty(token.variable);
    }

    // Apply the theme via data attribute to get its computed values
    if (themeName === "default") {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.setAttribute("data-theme", themeName);
    }

    // Wait a frame for styles to recompute then snapshot
    requestAnimationFrame(() => {
      const snap = snapshotAll();
      setOverrides(snap);
      baselineRef.current = snap;
      setChangedKeys(new Set());
    });
  }, []);

  const handleReset = useCallback(() => {
    for (const token of ALL_TOKENS) {
      document.documentElement.style.removeProperty(token.variable);
    }
    const snap = snapshotAll();
    setOverrides(snap);
    setChangedKeys(new Set());
    toast("All overrides cleared", { variant: "info" });
  }, [toast]);

  const copyThemeCSS = useCallback(
    (tokens: TokenDef[], successMsg: string) => {
      const lines = tokens.map((t) => `  ${t.variable}: ${overrides[t.variable]};`);
      const css = `:root[data-theme="custom"] {\n${lines.join("\n")}\n}`;
      navigator.clipboard.writeText(css).then(
        () => toast(successMsg, { variant: "success" }),
        () => toast("Failed to copy to clipboard", { variant: "error" })
      );
    },
    [overrides, toast]
  );

  const handleExport = useCallback(() => {
    const changed = ALL_TOKENS.filter((t) => changedKeys.has(t.variable));
    if (changed.length === 0) {
      toast("No changes to export. Modify some values first.", { variant: "warning" });
      return;
    }
    copyThemeCSS(changed, "CSS copied to clipboard!");
  }, [changedKeys, copyThemeCSS, toast]);

  const handleExportAll = useCallback(() => {
    copyThemeCSS(ALL_TOKENS, "Full theme CSS copied to clipboard!");
  }, [copyThemeCSS]);

  const changeCount = changedKeys.size;

  return (
    <div className="min-h-screen bg-canvas">
      {/* Header */}
      <div className="border-b border-border-default bg-surface-0 sticky top-0 z-30">
        <Container size="full" className="!max-w-[87.5rem]">
          <div className="flex items-center justify-between py-r5 gap-r4 flex-wrap">
            <Row gap="r5" align="center">
              <Pipette className="w-5 h-5 text-accent shrink-0" />
              <Text variant="h5" className="whitespace-nowrap">
                Theme Editor
              </Text>
              {changeCount > 0 && (
                <Badge variant="info">{changeCount} changed</Badge>
              )}
            </Row>

            <Row gap="r5" align="center" wrap>
              <Row gap="r6" align="center">
                <Text variant="body-3" color="secondary" className="whitespace-nowrap">
                  Start from
                </Text>
                <Select
                  className="!w-auto !py-1.5 !text-body-3"
                  onChange={(e) => handleLoadTheme(e.target.value)}
                >
                  {THEMES.map((t) => (
                    <option key={t} value={t}>
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </option>
                  ))}
                </Select>
              </Row>

              <IconButton
                aria-label="Reset all overrides"
                onClick={handleReset}
              >
                <RotateCcw className="w-4 h-4" />
              </IconButton>

              <Button
                size="sm"
                variant="secondary"
                onClick={handleExportAll}
              >
                <Download className="w-3.5 h-3.5 mr-1.5" />
                Export All
              </Button>

              <Button size="sm" onClick={handleExport}>
                <Clipboard className="w-3.5 h-3.5 mr-1.5" />
                Export Changes
              </Button>
            </Row>
          </div>
        </Container>
      </div>

      {/* Body */}
      <Container size="full" className="!max-w-[87.5rem] py-r2">
        <div className="flex gap-r3 flex-col lg:flex-row lg:items-start">
          {/* Editor panel */}
          <div className="flex-1 min-w-0">
            <Tabs defaultValue="colors" variant="pill">
              <Tabs.List className="mb-r4">
                {TAB_CONFIG.map((tab) => (
                  <Tabs.Tab key={tab.value} value={tab.value}>
                    {tab.label}
                  </Tabs.Tab>
                ))}
              </Tabs.List>

              {TAB_CONFIG.map((tab) => (
                <Tabs.Panel key={tab.value} value={tab.value}>
                  <Card padding="r3" shadow="sm">
                    <Stack gap="r4">
                      {tab.groups.map((group) => (
                        <TokenGroupSection
                          key={group.title}
                          group={group}
                          overrides={overrides}
                          onChange={handleChange}
                        />
                      ))}
                    </Stack>
                  </Card>
                </Tabs.Panel>
              ))}
            </Tabs>
          </div>

          {/* Preview panel */}
          <div className="w-full lg:w-[23.75rem] shrink-0">
            <LivePreview />
          </div>
        </div>
      </Container>
    </div>
  );
}

export default ThemeEditor;
