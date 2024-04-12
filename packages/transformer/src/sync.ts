#!/usr/bin/env node
import fs from "node:fs";
import ts from "typescript";
import { twoWaySync, getRepoPathFromCLI } from "./transformer";
import { Command } from "@commander-js/extra-typings";

if (require.main === module) {
  const program = new Command().requiredOption(
    "--lekko-dir <string>",
    "path to  directory with native Lekko files",
  );
  program.parse();
  const options = program.opts();
  const lekkoDir = options.lekkoDir;

  fs.readdirSync(lekkoDir).forEach((file) => {
    if (file.endsWith(".ts")) {
      const fullFilename = `${lekkoDir}/${file}`;
      const tsProgram = ts.createProgram([fullFilename], {
        target: ts.ScriptTarget.ESNext,
        outDir: "dist",
      });
      twoWaySync(tsProgram, {
        configSrcPath: lekkoDir,
        repoPath: getRepoPathFromCLI(),
        verbose: true,
      });
    }
  });
}
