import { expect, test } from "bun:test";
import { installDecision, parseBuild, type RelayBuild } from "../desktop/src/main/install-decision";

const build = (builtAt: string | null): RelayBuild => ({ version: "1.0.0", revision: null, builtAt });
const older = build("2026-11-05T07:53:00.000Z");
const newer = build("2026-11-06T05:30:00.000Z");

test("the desktop app installs its bundled relay.exe only when none is installed or the bundled one was built later", () => {
  expect(installDecision({ installed: false, same: false, installedBuild: null, bundledBuild: null })).toBe("install");
  expect(installDecision({ installed: true, same: true, installedBuild: null, bundledBuild: null })).toBe("same");
  expect(installDecision({ installed: true, same: false, installedBuild: older, bundledBuild: newer })).toBe("install");
  // A CLI reinstalled from the repository after the app was packaged is newer; the app must not put its older copy back.
  expect(installDecision({ installed: true, same: false, installedBuild: newer, bundledBuild: older })).toBe("keep");
  expect(installDecision({ installed: true, same: false, installedBuild: newer, bundledBuild: newer })).toBe("keep");
  // An installed relay.exe from before build stamps (no `version` command) is older than any stamped one.
  expect(installDecision({ installed: true, same: false, installedBuild: null, bundledBuild: newer })).toBe("install");
  expect(installDecision({ installed: true, same: false, installedBuild: build(null), bundledBuild: newer })).toBe("install");
  // When the bundled one cannot say when it was built, nobody can tell which is newer: keep what is installed.
  expect(installDecision({ installed: true, same: false, installedBuild: newer, bundledBuild: null })).toBe("keep");
  expect(installDecision({ installed: true, same: false, installedBuild: null, bundledBuild: build("not a date") })).toBe("keep");
});

test("parseBuild reads relay version --json and rejects anything else", () => {
  expect(parseBuild('{"schemaVersion":1,"version":"1.0.0","revision":"abc","builtAt":"2026-11-06T05:30:00.000Z"}'))
    .toEqual({ version: "1.0.0", revision: "abc", builtAt: "2026-11-06T05:30:00.000Z" });
  expect(parseBuild('{"schemaVersion":1,"version":"1.0.0","revision":null,"builtAt":null}')).toEqual({ version: "1.0.0", revision: null, builtAt: null });
  // An older relay.exe answers `version` with an error body on stderr and nothing on stdout.
  for (const bad of ["", "{", '{"schemaVersion":1,"error":{"code":"INVALID_ARGUMENT"}}', '{"schemaVersion":2,"version":"9"}']) expect(parseBuild(bad)).toBeNull();
});
