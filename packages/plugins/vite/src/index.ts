import { type PluginOption } from "vite";
import path from "node:path";
import ts from "typescript";
import { readDotLekko, transformer } from "@lekko/ts-transformer";

export interface LekkoViteOptions {
  verbose?: boolean;
}

// TODO: Investigate if this can be a compatible Rollup plugin instead
export default function (options: LekkoViteOptions = {}): PluginOption {
  const dotLekko = readDotLekko(".");

  return {
    name: "vite-plugin-lekko-typescript",
    enforce: "pre",

    config() {
      return {
        // Define global var replacements (i.e. embded these env vars)
        define: {
          "import.meta.env.VITE_LEKKO_REPOSITORY_OWNER": JSON.stringify(dotLekko.repoOwner),
          "import.meta.env.VITE_LEKKO_REPOSITORY_NAME": JSON.stringify(dotLekko.repoName),
        },
      };
    },

    transform: {
      // Want this transformer to run before other plugins'
      order: "pre",
      handler(code, id) {
        if (path.dirname(id) === path.resolve(dotLekko.lekkoPath)) {
          const tsProgram = ts.createProgram([id], { noEmit: true });
          const sourceFile = tsProgram.getSourceFile(id);
          if (sourceFile === undefined) {
            this.error(`Unable to fine source file ${id}`);
          }
          const result = ts.transform(sourceFile, [transformer(tsProgram, { verbose: options.verbose })]);
          const printer = ts.createPrinter();
          return {
            // TODO: Also output sourcemap, as recommended in conventional guidelines
            code: printer.printFile(result.transformed[0]),
          };
        }
        return;
      },
    },
  };
}
