import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommandRunner } from "../../scripts/generate-changelog";
import { computeSha256, runUpdateHomebrew, updateFormula } from "../../scripts/update-homebrew";

const SAMPLE_FORMULA = `class RalphReview < Formula
  desc "Orchestrating coding agents for code review, verification and fixing"
  homepage "https://github.com/kenryu42/ralph-review"
  url "https://github.com/kenryu42/ralph-review/archive/refs/tags/v0.1.4.tar.gz"
  sha256 "c9678bd37ebadc23410c6bd651f1e45f6ea147ed67810848604eddb1787378e7"
  license "MIT"

  depends_on "oven-sh/bun/bun"

  def install
    system "bun", "install", "--frozen-lockfile"
    libexec.install Dir["*"]
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/rr --version")
  end
end`;

const ENCODED_FORMULA = Buffer.from(SAMPLE_FORMULA).toString("base64");
const FORMULA_SHA = "abc123formulasha";

type RunnerResponse = string | Error;

function createMockRunner(responses: readonly [string, RunnerResponse][]): CommandRunner {
  return (strings: TemplateStringsArray, ...values: readonly string[]) => {
    const command = strings.reduce((accumulator, part, index) => {
      const value = values[index] ?? "";
      return `${accumulator}${part}${value}`;
    }, "");

    return {
      text: async () => {
        const match = responses.find(([pattern]) => command.includes(pattern));
        if (!match) {
          throw new Error(`Unexpected command: ${command}`);
        }

        const response = match[1];
        if (response instanceof Error) {
          throw response;
        }

        return response;
      },
    };
  };
}

describe("updateFormula", () => {
  test("updates url and sha256 to new version", () => {
    const result = updateFormula(SAMPLE_FORMULA, "1.0.0", "abc123def456");

    expect(result).toContain(
      'url "https://github.com/kenryu42/ralph-review/archive/refs/tags/v1.0.0.tar.gz"'
    );
    expect(result).toContain('sha256 "abc123def456"');
  });

  test("preserves all other formula content", () => {
    const result = updateFormula(SAMPLE_FORMULA, "1.0.0", "abc123");

    expect(result).toContain('desc "Orchestrating coding agents');
    expect(result).toContain('homepage "https://github.com/kenryu42/ralph-review"');
    expect(result).toContain('license "MIT"');
    expect(result).toContain('depends_on "oven-sh/bun/bun"');
    expect(result).toContain("def install");
  });

  test("does not modify homepage url", () => {
    const result = updateFormula(SAMPLE_FORMULA, "1.0.0", "abc123");

    expect(result).toContain('homepage "https://github.com/kenryu42/ralph-review"');
  });

  test("replaces only the first url and sha256 match", () => {
    const formulaWithResource = `${SAMPLE_FORMULA}

  resource "extra" do
    url "https://example.com/extra-0.1.tar.gz"
    sha256 "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
  end`;

    const result = updateFormula(formulaWithResource, "2.0.0", "newsha");

    expect(result).toContain(
      'url "https://github.com/kenryu42/ralph-review/archive/refs/tags/v2.0.0.tar.gz"'
    );
    expect(result).toContain('sha256 "newsha"');
    expect(result).toContain('url "https://example.com/extra-0.1.tar.gz"');
    expect(result).toContain(
      'sha256 "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"'
    );
  });
});

describe("computeSha256", () => {
  let tempDir: string;
  let okUrl: string;
  let missingUrl: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "ralph-review-update-homebrew-"));

    const okPath = join(tempDir, "ok.txt");
    await Bun.write(okPath, "hello world");

    okUrl = `file://${okPath}`;
    missingUrl = `file://${join(tempDir, "missing.txt")}`;
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("returns hex sha256 of response body", async () => {
    const hash = await computeSha256(okUrl);
    const expected = new Bun.CryptoHasher("sha256").update("hello world").digest("hex");

    expect(hash).toBe(expected);
  });

  test("throws when the tarball cannot be downloaded", async () => {
    await expect(computeSha256(missingUrl)).rejects.toThrow("Failed to download tarball");
  });

  test("wraps non-ok HTTP responses with a download error", async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        return new Response("download failed", { status: 500, statusText: "" });
      },
    });

    try {
      await expect(
        computeSha256(`http://127.0.0.1:${server.port}/ralph-review.tar.gz`)
      ).rejects.toThrow("Failed to download tarball: Internal Server Error");
    } finally {
      server.stop(true);
    }
  });
});

describe("runUpdateHomebrew", () => {
  test("throws when no version is provided", async () => {
    await expect(runUpdateHomebrew(undefined, { log: () => {} })).rejects.toThrow(
      "VERSION env var or argument is required"
    );
  });

  test("fetches formula, computes sha, and pushes update in a single API call", async () => {
    const commands: string[] = [];
    const runner = createMockRunner([
      [
        'gh api "/repos/kenryu42/homebrew-tap/contents/Formula/ralph-review.rb"',
        JSON.stringify({ content: ENCODED_FORMULA, sha: FORMULA_SHA }),
      ],
      ["gh api --method PUT", "{}"],
    ]);

    const trackedRunner: CommandRunner = (
      strings: TemplateStringsArray,
      ...values: readonly string[]
    ) => {
      const command = strings.reduce((acc, part, i) => `${acc}${part}${values[i] ?? ""}`, "");
      commands.push(command);
      return runner(strings, ...values);
    };

    await runUpdateHomebrew("1.0.0", {
      run: trackedRunner,
      computeSha: async () => "deadbeef",
      log: () => {},
    });

    // Only 2 API calls: one GET (content+sha) and one PUT
    expect(commands).toHaveLength(2);
    expect(commands[0]).toContain('gh api "/repos/kenryu42/homebrew-tap/contents/');
    expect(commands[0]).not.toContain("--method PUT");

    // PUT includes the updated sha256 and formula sha
    expect(commands[1]).toContain("--method PUT");
    expect(commands[1]).toContain(`-f sha=${FORMULA_SHA}`);
  });

  test("updates formula with computed sha and new version", async () => {
    let putContent = "";
    const runner: CommandRunner = (strings: TemplateStringsArray, ...values: readonly string[]) => {
      const command = strings.reduce((acc, part, i) => `${acc}${part}${values[i] ?? ""}`, "");

      return {
        text: async () => {
          if (command.includes("--method PUT")) {
            const contentMatch = command.match(/-f content=([^\s\\]+)/);
            if (contentMatch?.[1]) putContent = contentMatch[1];
            return "{}";
          }
          return JSON.stringify({ content: ENCODED_FORMULA, sha: FORMULA_SHA });
        },
      };
    };

    await runUpdateHomebrew("2.0.0", {
      run: runner,
      computeSha: async () => "newsha256hash",
      log: () => {},
    });

    const decoded = Buffer.from(putContent, "base64").toString();
    expect(decoded).toContain(
      'url "https://github.com/kenryu42/ralph-review/archive/refs/tags/v2.0.0.tar.gz"'
    );
    expect(decoded).toContain('sha256 "newsha256hash"');
    expect(decoded).toContain('homepage "https://github.com/kenryu42/ralph-review"');
  });

  test("logs progress messages", async () => {
    const messages: string[] = [];
    const runner = createMockRunner([
      [
        'gh api "/repos/kenryu42/homebrew-tap/contents/Formula/ralph-review.rb"',
        JSON.stringify({ content: ENCODED_FORMULA, sha: FORMULA_SHA }),
      ],
      ["gh api --method PUT", "{}"],
    ]);

    await runUpdateHomebrew("1.0.0", {
      run: runner,
      computeSha: async () => "abc",
      log: (msg) => messages.push(msg),
    });

    expect(messages.some((m) => m.includes("Updating Homebrew tap for v1.0.0"))).toBe(true);
    expect(messages.some((m) => m.includes("Computing SHA256"))).toBe(true);
    expect(messages.some((m) => m.includes("Fetching current formula"))).toBe(true);
    expect(messages.some((m) => m.includes("Pushing updated formula"))).toBe(true);
    expect(messages.some((m) => m.includes("Homebrew tap updated to v1.0.0"))).toBe(true);
  });
});
