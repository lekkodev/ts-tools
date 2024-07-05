import ts from "typescript";
import path from "node:path";
import type { LoaderDefinitionFunction } from "webpack";
import { transformer } from "@lekko/ts-transformer";

export interface LekkoWebpackLoaderOptions {
  lekkoPath: string;
  verbose?: boolean;
}

const loader: LoaderDefinitionFunction<LekkoWebpackLoaderOptions> = function (source) {
  if (source === undefined || source === null) {
    return source;
  }
  const options = this.getOptions();
  // Resource gives path to Lekko config source file
  const resource = this.resource;
  // Invoke transformer
  if (path.resolve(options.lekkoPath) === path.dirname(this.resource)) {
    const tsProgram = ts.createProgram([resource], { noEmit: true });
    const sourceFile = tsProgram.getSourceFile(this.resource);
    if (sourceFile === undefined) {
      this.emitError(new Error(`Unable to find source file ${this.resource}`));
      return source;
    }
    const result = ts.transform(sourceFile, [transformer(tsProgram, { verbose: options.verbose })]);
    const printer = ts.createPrinter();
    return printer.printFile(result.transformed[0]);
  }
  return source;
};

export default loader;
