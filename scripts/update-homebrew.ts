#!/usr/bin/env bun

import { $ } from "bun";

const TAP_REPO = "kenryu42/homebrew-tap";
const FORMULA_PATH = "Formula/ralph-review.rb";
const SOURCE_REPO = "kenryu42/ralph-review";

async function computeSha256(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download tarball: ${response.statusText}`);
  }
  const buffer = await response.arrayBuffer();
  const hash = new Bun.CryptoHasher("sha256").update(buffer).digest("hex");
  return hash;
}

function updateFormula(formula: string, version: string, sha256: string): string {
  const tarballUrl = `https://github.com/${SOURCE_REPO}/archive/refs/tags/v${version}.tar.gz`;
  return formula
    .replace(/url ".*"/, `url "${tarballUrl}"`)
    .replace(/sha256 ".*"/, `sha256 "${sha256}"`);
}

export async function runUpdateHomebrew(version?: string): Promise<void> {
  const newVersion = version ?? process.env.VERSION;
  if (!newVersion) {
    console.error("VERSION env var or argument is required");
    process.exit(1);
  }

  console.log(`\n=== Updating Homebrew tap for v${newVersion} ===\n`);

  const tarballUrl = `https://github.com/${SOURCE_REPO}/archive/refs/tags/v${newVersion}.tar.gz`;

  console.log("Computing SHA256...");
  const sha256 = await computeSha256(tarballUrl);
  console.log(`SHA256: ${sha256}`);

  console.log("\nFetching current formula...");
  const formula =
    await $`gh api "/repos/${TAP_REPO}/contents/${FORMULA_PATH}" --jq '.content' | base64 -d`.text();

  const updated = updateFormula(formula, newVersion, sha256);

  console.log("Pushing updated formula...");
  const encoded = Buffer.from(updated).toString("base64");
  const fileSha = await $`gh api "/repos/${TAP_REPO}/contents/${FORMULA_PATH}" --jq '.sha'`.text();

  await $`gh api --method PUT "/repos/${TAP_REPO}/contents/${FORMULA_PATH}" \
    -f message=${`chore: bump ralph-review to v${newVersion}`} \
    -f content=${encoded} \
    -f sha=${fileSha.trim()}`;

  console.log(`\n=== Homebrew tap updated to v${newVersion} ===`);
}

if (import.meta.main) {
  const version = process.argv[2] ?? process.env.VERSION;
  runUpdateHomebrew(version).catch((error) => {
    console.error(`Failed to update Homebrew tap: ${error}`);
    process.exit(1);
  });
}
