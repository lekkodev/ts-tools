#!/usr/bin/env node
import { bisync } from "./transformer";
import { Command } from "@commander-js/extra-typings";

if (require.main === module) {
  process.on("uncaughtException", function (err) {
    console.error(err);
    process.exit(1);
  });

  const program = new Command()
    .option("--lekko-dir <string>", "path to directory with native Lekko files")
    .option("--repo-path <string>", "path to local config repository");
  program.parse();
  const options = program.opts();
  const lekkoDir = options.lekkoDir;
  const repoPath = options.repoPath;

  bisync(lekkoDir, repoPath);
}
