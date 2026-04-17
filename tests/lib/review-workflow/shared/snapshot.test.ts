import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copySnapshotDirectoryPreservingMetadata } from "@/lib/review-workflow/shared/snapshot";

function runCommandIn(cwd: string, args: string[]): string {
  const result = Bun.spawnSync(args, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`${args.join(" ")} failed: ${result.stderr.toString().trim()}`);
  }
  return result.stdout.toString().trim();
}

describe("review-workflow/shared/snapshot", () => {
  let tempDir: string;
  let sourcePath: string;
  let destinationPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "ralph-snapshot-shared-test-"));
    sourcePath = join(tempDir, "source");
    destinationPath = join(tempDir, "destination");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("copies hidden files, symlinks, and executable modes", async () => {
    await Bun.write(join(sourcePath, ".gitignore"), "node_modules\n", {
      createPath: true,
    });
    await Bun.write(join(sourcePath, ".tooling/config.json"), '{"enabled":true}\n', {
      createPath: true,
    });
    await Bun.write(join(sourcePath, "scripts/run.sh"), "#!/bin/sh\necho ok\n", {
      createPath: true,
    });
    runCommandIn(sourcePath, ["chmod", "+x", "scripts/run.sh"]);
    runCommandIn(sourcePath, ["ln", "-s", "scripts/run.sh", ".run-link"]);

    copySnapshotDirectoryPreservingMetadata(sourcePath, destinationPath);

    expect(await Bun.file(join(destinationPath, ".gitignore")).text()).toBe("node_modules\n");
    expect(await Bun.file(join(destinationPath, ".tooling/config.json")).text()).toBe(
      '{"enabled":true}\n'
    );
    expect(runCommandIn(destinationPath, ["test", "-x", "scripts/run.sh"])).toBe("");
    expect(runCommandIn(destinationPath, ["test", "-L", ".run-link"])).toBe("");
    expect(runCommandIn(destinationPath, ["readlink", ".run-link"])).toBe("scripts/run.sh");
  });
});
