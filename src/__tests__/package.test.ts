import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/** The npm package ships the server, not source maps or compiled tests. */
describe("npm package contents", () => {
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { files: string[]; version: string };

  it("excludes source maps and compiled tests", () => {
    expect(pkg.files).toContain("dist");
    expect(pkg.files).toContain("!dist/**/*.map");
    expect(pkg.files).toContain("!dist/__tests__");
  });

  it("is version 2.0.0", () => {
    expect(pkg.version).toBe("2.0.0");
  });
});
