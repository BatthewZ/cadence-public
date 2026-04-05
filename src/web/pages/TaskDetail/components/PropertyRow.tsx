import { Text } from "@/web/components/ui/Text";

export function PropertyRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center min-h-[2rem]">
      <Text as="span" variant="body-3" color="muted" className="w-[6.25rem] shrink-0">
        {label}
      </Text>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
