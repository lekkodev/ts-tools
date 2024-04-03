#!/usr/bin/env node
import ts from "typescript";
import { program } from "commander";
import transformProgram, { transformer } from "./transformer";
import * as helpers from "./helpers";
import { emitEnvVars } from "./emit-env-vars";

if (require.main === module) {
  program.requiredOption(
    "-f, --filename <string>",
    "ts file to convert to Lekko",
  );
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

export { helpers, transformer, emitEnvVars };
