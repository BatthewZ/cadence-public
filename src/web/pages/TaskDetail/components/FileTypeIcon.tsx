import {
  File,
  FileArchive,
  FileSpreadsheet,
  FileText,
  Presentation,
} from "lucide-react";

export function FileTypeIcon({ mimeType }: { mimeType: string }) {
  let Icon = File;
  if (mimeType === "application/pdf") Icon = FileText;
  else if (
    mimeType === "application/vnd.ms-excel" ||
    mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  )
    Icon = FileSpreadsheet;
  else if (
    mimeType === "application/vnd.ms-powerpoint" ||
    mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  )
    Icon = Presentation;
  else if (mimeType.startsWith("text/")) Icon = FileText;
  else if (mimeType === "application/zip") Icon = FileArchive;

  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded bg-surface-2 text-fg-muted">
      <Icon size={20} />
    </span>
  );
}
