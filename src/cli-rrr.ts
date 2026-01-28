#!/usr/bin/env bun
/**
 * rrr - Quick alias for rr run
 */

import { printCommandHelp } from "./cli";
import { runRun } from "./commands/run";

const userArgs = process.argv.slice(2);

// Handle --help specially
if (userArgs.includes("--help") || userArgs.includes("-h")) {
  console.log("rrr - Quick alias for 'rr run'\n");
  console.log("USAGE:");
  console.log("  rrr [options]\n");
  console.log("All options are passed through to 'rr run'.\n");
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

runRun(userArgs).catch((error) => {
  console.error(`Error: ${error}`);
  process.exit(1);
});
