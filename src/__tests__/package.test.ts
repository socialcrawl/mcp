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

  it("is version 2.0.2, the same everywhere it is stated", async () => {
    expect(pkg.version).toBe("2.0.2");
    const server = JSON.parse(readFileSync(new URL("../../server.json", import.meta.url), "utf8")) as { version: string; packages: Array<{ version: string }> };
    expect(server.version).toBe("2.0.2");
    expect(server.packages.map((p) => p.version)).toEqual(["2.0.2"]);
    const { SERVER_VERSION } = await import("../constants.js");
    expect(SERVER_VERSION).toBe("2.0.2");
  });
});
