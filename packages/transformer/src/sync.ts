#!/usr/bin/env node
import fs from "node:fs";
import ts from "typescript";
import { twoWaySync, getRepoPathFromCLI } from "./transformer";
import { Command } from "@commander-js/extra-typings";

if (require.main === module) {
  process.on("uncaughtException", function (err) {
    console.error(err);
    process.exit(1);
  });

  const program = new Command()
    .requiredOption(
      "--lekko-dir <string>",
      "path to  directory with native Lekko files",
    )
    .option("--repo-path <string>", "path to local config repository");
  program.parse();
  const options = program.opts();
  const lekkoDir = options.lekkoDir;
  const repoPath = options.repoPath ?? getRepoPathFromCLI();

  fs.readdirSync(lekkoDir).forEach((file) => {
    if (file.endsWith(".ts")) {
      const fullFilename = `${lekkoDir}/${file}`;
      const tsProgram = ts.createProgram([fullFilename], {
        target: ts.ScriptTarget.ESNext,
        noEmit: true,
      });
      twoWaySync(tsProgram, {
        configSrcPath: lekkoDir,
        repoPath: repoPath,
        verbose: true,
      });
    }
  });
}
