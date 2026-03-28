import { Field, Input, Label } from "@/web/components/form";
import { Text } from "@/web/components/ui";
import { cn } from "@/web/util/style/style";

import { toHex } from "./helpers";
import type { TokenGroup } from "./token-constants";

function ColorTokenInput({
  variable,
  label,
  value,
  onChange,
}: {
  variable: string;
  label: string;
  value: string;
  onChange: (variable: string, value: string) => void;
}) {
  const hex = toHex(value);
  return (
    <div className="flex flex-col gap-r6">
      <Text variant="body-3" color="secondary" className="truncate" title={variable}>
        {label}
      </Text>
      <div className="flex items-center gap-r6">
        <label
          className={cn(
            "relative shrink-0 w-9 h-9 rounded-md overflow-hidden cursor-pointer",
            "border border-border-strong",
            "hover:ring-2 hover:ring-border-focus hover:ring-offset-1 duration-fast"
          )}
          style={{ backgroundColor: hex }}
        >
          <input
            type="color"
            value={hex}
            onChange={(e) => onChange(variable, e.target.value)}
            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
          />
        </label>
        <Input
          value={value}
          onChange={(e) => onChange(variable, e.target.value)}
          className="!py-1.5 !text-body-3 mono-font min-w-0"
        />
      </div>
    </div>
  );
}

function TextTokenInput({
  variable,
  label,
  value,
  onChange,
}: {
  variable: string;
  label: string;
  value: string;
  onChange: (variable: string, value: string) => void;
}) {
  return (
    <Field>
      <Label className="!text-body-3 !font-normal !text-fg-secondary truncate" title={variable}>
        {label}
      </Label>
      <Input
        value={value}
        onChange={(e) => onChange(variable, e.target.value)}
        className="!py-1.5 !text-body-3 mono-font"
      />
    </Field>
  );
}

function TokenGroupSection({
  group,
  overrides,
  onChange,
}: {
  group: TokenGroup;
  overrides: Record<string, string>;
  onChange: (variable: string, value: string) => void;
}) {
  const isColorGroup = group.tokens[0]?.type === "color";

  return (
    <div>
      <Text variant="body-2" weight="semibold" className="mb-r5">
        {group.title}
      </Text>
      <div
        className={cn(
          "grid gap-x-r4 gap-y-r5",
          isColorGroup
            ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
            : "grid-cols-1 sm:grid-cols-2"
        )}
      >
        {group.tokens.map((token) =>
          token.type === "color" ? (
            <ColorTokenInput
              key={token.variable}
              variable={token.variable}
              label={token.label}
              value={overrides[token.variable] ?? ""}
              onChange={onChange}
            />
          ) : (
            <TextTokenInput
              key={token.variable}
              variable={token.variable}
              label={token.label}
              value={overrides[token.variable] ?? ""}
              onChange={onChange}
            />
          )
        )}
      </div>
    </div>
  );
}

export { ColorTokenInput, TextTokenInput, TokenGroupSection };
