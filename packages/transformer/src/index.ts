#!/usr/bin/env node
import path from "path";
import os from "os";
import ts from "typescript";
import { program } from "commander";
import transformProgram, { transformer } from "./transformer";
import * as helpers from "./helpers";

if (require.main === module) {
  program
    .option(
      "-r, --repo-path <string>",
      "path to the config repo",
      path.join(
        os.homedir(),
        "Library/Application Support/Lekko/Config Repositories/default/",
      ),
    )
    .requiredOption("-f, --filename <string>", "ts file to convert to Lekko");
  program.parse();
  const options = program.opts();

  const filename = String(options.filename);

  let tsProgram = ts.createProgram([filename], {
    target: ts.ScriptTarget.ESNext,
    outDir: "dist",
  });

  tsProgram = transformProgram(
    tsProgram,
    undefined,
    { noStatic: true },
    { ts },
  );
  tsProgram.emit();
}

export default transformProgram;

export { helpers, transformer };
