import { Badge, type ColumnDef, Text } from "@/web/components/ui";

export interface DeliveryRow {
  id: string;
  webhookId: string;
  event: string;
  statusCode: number | null;
  success: boolean;
  response: string | null;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  lastAttemptAt: string;
}

function formatTimestamp(raw: string): string {
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const deliveryColumns: ColumnDef<DeliveryRow>[] = [
  {
    key: "event",
    header: "Event",
    render: (row) => (
      <Text variant="body-3" className="font-mono">
        {row.event}
      </Text>
    ),
  },
  {
    key: "status",
    header: "Status",
    render: (row) => (
      <Badge variant={row.success ? "success" : "error"}>
        {row.success ? "Success" : "Failed"}
      </Badge>
    ),
  },
  {
    key: "statusCode",
    header: "Code",
    render: (row) => (
      <Text variant="body-3" color="muted">
        {row.statusCode ?? "-"}
      </Text>
    ),
  },
  {
    key: "attempts",
    header: "Attempts",
    className: "hidden sm:table-cell",
    render: (row) => (
      <Text variant="body-3" color="muted">
        {row.attempts}/{row.maxAttempts}
      </Text>
    ),
  },
  {
    key: "createdAt",
    header: "Timestamp",
    className: "hidden sm:table-cell",
    render: (row) => (
      <Text variant="body-3" color="muted">
        {formatTimestamp(row.createdAt)}
      </Text>
    ),
  },
];
