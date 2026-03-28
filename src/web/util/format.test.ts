import { describe, expect, it } from "vitest";

import { formatBytes } from "./format";

describe("formatBytes", () => {
  it("formats 0 bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("formats small byte values", () => {
    expect(formatBytes(512)).toBe("512 B");
  });

  it("formats KB range", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
  });

  it("formats MB range", () => {
    expect(formatBytes(1048576)).toBe("1.0 MB");
    expect(formatBytes(5242880)).toBe("5.0 MB");
  });

  it("keeps 1023 bytes in bytes range", () => {
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("switches to KB at exactly 1024", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
  });

  it("keeps 1048575 in KB range", () => {
    expect(formatBytes(1048575)).toBe("1024.0 KB");
  });

  it("switches to MB at exactly 1048576", () => {
    expect(formatBytes(1048576)).toBe("1.0 MB");
  });
});
