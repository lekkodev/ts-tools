#!/usr/bin/env node
import { Command } from "@commander-js/extra-typings";
import { spawnSync } from "child_process";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { getRepoPathFromCLI, twoWaySync } from "./transformer";
import { LEKKO_CLI_NOT_FOUND } from "./types";

if (require.main === module) {
  const program = new Command().requiredOption(
    "--lekko-dir <string>",
    "path to  directory with native Lekko files",
  );
  program.parse();
  const options = program.opts();
  const lekkoDir = path.normalize(options.lekkoDir);

  fs.readdirSync(lekkoDir).forEach((file) => {
    if (file.endsWith(".ts")) {
      const fullFilename = path.join(lekkoDir, file);
      const tsProgram = ts.createProgram([fullFilename], {
        target: ts.ScriptTarget.ESNext,
        outDir: "dist",
      });
      twoWaySync(tsProgram, {
        configSrcPath: lekkoDir,
        repoPath: getRepoPathFromCLI(),
        verbose: true,
      });

      const repoCmd = spawnSync("lekko", ["merge-file", "-f", fullFilename], {
        encoding: "utf-8",
      });
      if (repoCmd.error !== undefined) {
        const err = repoCmd.error as unknown as NodeJS.ErrnoException;
        if (err.code === "ENOENT") {
          console.warn(LEKKO_CLI_NOT_FOUND)
          process.exit(1)
        }
      }
      if (repoCmd.stdout?.includes("unknown command")) {
        console.warn("Incompatible version of Lekko CLI. Please upgrade with `brew update && brew lekko upgrade`.")
        process.exit(1)
      }
      if (repoCmd.error !== undefined || repoCmd.status !== 0) {
        console.warn(`Failed to merge remote changes: ${repoCmd.stdout}`)
        process.exit(1)
      }
      console.log(repoCmd.stdout.trim());
    }
  });
}
