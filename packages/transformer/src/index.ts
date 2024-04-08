#!/usr/bin/env node
import ts from "typescript";
import path from "path";
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

  // twoWaySync(tsProgram, {
  //   configSrcPath: path.dirname(filename),
  //   target: "next",
  //   emitEnv: false,
  // });

  tsProgram = transformProgram(
    tsProgram,
    undefined,
    {
      configSrcPath: path.dirname(filename),
      target: "next",
      emitEnv: false,
    },
    { ts },
  );
  tsProgram.emit();
}

export default transformProgram;

export { helpers, transformer, emitEnvVars };
export * as errors from "./errors";
