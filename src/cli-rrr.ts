#!/usr/bin/env bun

import { printCommandHelp } from "./cli";
import { startReview } from "./commands/run";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log("rrr - Quick alias for 'rr run'\n");
  console.log("USAGE:");
  console.log("  rrr [options]\n");
  console.log("All options are passed through to 'rr run'.\n");
  const optionsMatch = printCommandHelp("run")?.match(/OPTIONS:[\s\S]*?(?=\nEXAMPLES:|\n\n|$)/);
  if (optionsMatch) {
    console.log(optionsMatch[0]);
  }
  process.exit(0);
}

startReview(args).catch((error) => {
  console.error(`Error: ${error}`);
  process.exit(1);
});
