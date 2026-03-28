import { Dialog } from "@/web/components/ui/Dialog";
import { Text } from "@/web/components/ui/Text";

interface KeyboardShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
}

interface ShortcutEntry {
  keys: string[];
  description: string;
  /** Use "+" for simultaneous combos (Ctrl+K), "then" for sequential chords (g then d). Defaults to "then". */
  separator?: "+" | "then";
}

interface ShortcutSection {
  title: string;
  shortcuts: ShortcutEntry[];
}

const SHORTCUT_SECTIONS: ShortcutSection[] = [
  {
    title: "General",
    shortcuts: [
      { keys: ["Ctrl", "K"], description: "Open search", separator: "+" },
      { keys: ["?"], description: "Show keyboard shortcuts" },
    ],
  },
  {
    title: "Navigation",
    shortcuts: [
      { keys: ["g", "d"], description: "Go to Dashboard" },
      { keys: ["g", "m"], description: "Go to My Tasks" },
      { keys: ["g", "p"], description: "Go to Projects" },
      { keys: ["g", "s"], description: "Go to Settings" },
      { keys: ["g", "e"], description: "Go to Members" },
    ],
  },
];

export function KeyboardShortcutsDialog({ open, onClose }: KeyboardShortcutsDialogProps) {
  return (
    <Dialog open={open} onClose={onClose}>
      <div className="keyboard-shortcuts-dialog">
        <div className="keyboard-shortcuts-dialog__header">
          <Text variant="h5" as="h2">
            Keyboard Shortcuts
          </Text>
          <button
            type="button"
            onClick={onClose}
            className="keyboard-shortcuts-dialog__close"
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        <div className="keyboard-shortcuts-dialog__body">
          {SHORTCUT_SECTIONS.map((section) => (
            <div key={section.title} className="keyboard-shortcuts-dialog__section">
              <Text variant="body-2" weight="semibold" color="muted" className="keyboard-shortcuts-dialog__section-title">
                {section.title}
              </Text>
              <div className="keyboard-shortcuts-dialog__list">
                {section.shortcuts.map((shortcut) => (
                  <div key={shortcut.description} className="keyboard-shortcuts-dialog__row">
                    <span className="keyboard-shortcuts-dialog__description">
                      {shortcut.description}
                    </span>
                    <span className="keyboard-shortcuts-dialog__keys">
                      {shortcut.keys.map((k, i) => (
                        <span key={`${k}-${i}`}>
                          <kbd className="keyboard-shortcuts-dialog__kbd">{k}</kbd>
                          {i < shortcut.keys.length - 1 && (
                            <span className="keyboard-shortcuts-dialog__separator">{shortcut.separator ?? "then"}</span>
                          )}
                        </span>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
