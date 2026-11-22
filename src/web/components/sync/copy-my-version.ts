type NotifyCopy = (message: string, options: { variant: "success" | "error" }) => unknown;

/** The "Copy my version" action on a description-conflict toast: puts the unsaved text on the clipboard. */
export function copyMyVersion(text: string, toast: NotifyCopy): void {
  const copied = () => toast("Your version is on the clipboard.", { variant: "success" });
  const failed = () => toast("Couldn't copy to the clipboard.", { variant: "error" });
  try {
    navigator.clipboard.writeText(text).then(copied, failed);
  } catch {
    // navigator.clipboard is undefined outside secure contexts, so the call throws synchronously.
    failed();
  }
}
