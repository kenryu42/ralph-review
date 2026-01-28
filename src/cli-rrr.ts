#!/usr/bin/env bun
/**
 * rrr - Shortcut for `rr run -b`
 * Starts a background review session with -b (background) flag always set
 */

import { printCommandHelp } from "./cli";
import { runRun } from "./commands/run";

const userArgs = process.argv.slice(2);

// Handle --help specially
if (userArgs.includes("--help") || userArgs.includes("-h")) {
  console.log("rrr - Shortcut for 'rr run -b'\n");
  console.log("USAGE:");
  console.log("  rrr [options]\n");
  console.log("This command always runs in background mode (-b).");
  console.log("All other options are passed through to 'rr run'.\n");
  const help = printCommandHelp("run");
  if (help) {
    // Extract just the OPTIONS section from run help
    const optionsMatch = help.match(/OPTIONS:[\s\S]*?(?=\nEXAMPLES:|\n\n|$)/);
    if (optionsMatch) {
      console.log(optionsMatch[0]);
    }
  }
  process.exit(0);
}

// Forward user args but always include -b (unless already present)
const hasBackground = userArgs.includes("-b") || userArgs.includes("--background");
const args = hasBackground ? userArgs : ["-b", ...userArgs];

runRun(args).catch((error) => {
  console.error(`Error: ${error}`);
  process.exit(1);
});
