#!/usr/bin/env bun

import { printCommandHelp } from "./cli";
import { startReview } from "./commands/run";

const userArgs = process.argv.slice(2);

// Show rrr-specific help that delegates to 'rr run' options
if (userArgs.includes("--help") || userArgs.includes("-h")) {
  console.log("rrr - Quick alias for 'rr run'\n");
  console.log("USAGE:");
  console.log("  rrr [options]\n");
  console.log("All options are passed through to 'rr run'.\n");
  const help = printCommandHelp("run");
  if (help) {
    const optionsMatch = help.match(/OPTIONS:[\s\S]*?(?=\nEXAMPLES:|\n\n|$)/);
    if (optionsMatch) {
      console.log(optionsMatch[0]);
    }
  }
  process.exit(0);
}

startReview(userArgs).catch((error) => {
  console.error(`Error: ${error}`);
  process.exit(1);
});
