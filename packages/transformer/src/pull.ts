#!/usr/bin/env node
import fs from "node:fs";
import ts from "typescript";
import transformProgram, {
  transformer,
  twoWaySync,
  getRepoPathFromCLI,
} from "./transformer";
import * as helpers from "./helpers";
import { emitEnvVars } from "./emit-env-vars";
import { spawnSync } from "child_process";
import path from "node:path";

function detectLekkoDir(): string | undefined {
  for (const dirent of fs.readdirSync(".", {
    withFileTypes: true,
    recursive: true,
  })) {
    if (dirent.isDirectory() && dirent.name === "lekko") {
      // sanity check that there is a "gen" directory inside
      const fullPath = path.join(dirent.path, dirent.name);
      const genDir = fs
        .readdirSync(fullPath, {
          withFileTypes: true,
        })
        .find((dirent) => dirent.isDirectory() && dirent.name === "gen");
      if (genDir !== undefined) {
        return fullPath;
      }
    }
  }
  return undefined;
}

if (require.main === module) {
  const lekkoDir = detectLekkoDir();
  if (lekkoDir === undefined) {
    console.error("could not find a valid lekko/ directory in file tree");
    process.exit(1);
  }
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

      const repoCmd = spawnSync("lekko", ["repo", "pull", "-f", fullFilename], {
        encoding: "utf-8",
      });
      if (repoCmd.error !== undefined || repoCmd.status !== 0) {
        throw new Error(`failed to pull: ${repoCmd.stdout}${repoCmd.stderr}`);
      }
      console.log(repoCmd.stdout.trim());
    }
  });
}

export default transformProgram;

export { helpers, transformer, emitEnvVars };
export * as errors from "./errors";
