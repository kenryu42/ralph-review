#!/usr/bin/env bun

import { printCommandHelp } from "@/cli-core";
import { startReview } from "@/commands/run";

export async function runRrr(args: string[] = process.argv.slice(2)): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log("rrr - Quick alias for 'rr run'\n");
    console.log("USAGE:");
    console.log("  rrr [options]\n");
    console.log("All options are passed through to 'rr run'.\n");
    const optionsMatch = printCommandHelp("run")?.match(/OPTIONS:[\s\S]*?(?=\nEXAMPLES:|\n\n|$)/);
    if (optionsMatch) {
      console.log(optionsMatch[0]);
    }
    return;
  }

  await startReview(args);
}

if (import.meta.main) {
  runRrr().catch((error) => {
    console.error(`Error: ${error}`);
    process.exit(1);
  });
}
