#!/usr/bin/env node
import { Command } from "@commander-js/extra-typings";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { sourceFileToJson } from "./ts-to-lekko";
import { isLekkoConfigFile } from "./helpers";

if (require.main === module) {
  process.on("uncaughtException", function (err) {
    console.error(err);
    process.exit(1);
  });

  const program = new Command().requiredOption(
    "--lekko-dir <string>",
    "path to  directory with native Lekko files",
  );
  program.parse();
  const options = program.opts();
  const lekkoDir = path.normalize(options.lekkoDir);

  const files = fs
    .readdirSync(lekkoDir)
    .filter((file) => file.endsWith(".ts"))
    .map((file) => path.join(lekkoDir, file));
  const tsProgram = ts.createProgram(files, {
    target: ts.ScriptTarget.ESNext,
    outDir: "dist",
  });
  const lekkoSourceFiles = tsProgram
    .getSourceFiles()
    .filter((sourceFile) => isLekkoConfigFile(sourceFile.fileName, lekkoDir));

  const json = lekkoSourceFiles.map((file) =>
    sourceFileToJson(file, tsProgram),
  );
  console.log(JSON.stringify({ namespaces: json }));
}
