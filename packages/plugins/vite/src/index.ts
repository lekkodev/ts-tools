import { type Rollup, type Plugin, type PluginOption } from "vite";
import transformerFactory from "@lekko/ts-transformer";
import ts from "typescript";

// TODO: We should allow users to specify location
// **/lekko/<namespace>.ts, namespace must be kebab-case alphanumeric
export const LEKKO_FILENAME_REGEX = /lekko\/([a-z][a-z0-9-]*)\.ts$/;

export interface LekkoViteOptions {
  /**
   * Which Vite operations this plugin should apply to.
   * Use `serve` for dev mode (i.e. `vite`, `vite serve`) and `build` for
   * production builds (i.e. `vite build`). Defaults to only run on build.
   */
  apply?: Plugin["apply"];
}

// TODO: Investigate if this can be a compatible Rollup plugin instead
export default function (options: LekkoViteOptions = {}): PluginOption {
  const { apply } = options;

  return {
    name: "vite-plugin-lekko-typescript",
    enforce: "pre",
    apply,

    transform(code, id): Rollup.TransformResult {
      if (LEKKO_FILENAME_REGEX.test(id)) {
        // TODO: Read project tsconfig
        const program = ts.createProgram([id], {
          target: ts.ScriptTarget.ES2017,
        });
        const sourceFile = program.getSourceFile(id);
        if (sourceFile === undefined) {
          return {
            code,
          };
        }
        const transformed = ts.transform(sourceFile, [
          // TODO: Fix cjs/esm interop across packages
          transformerFactory.default(program, { noStatic: true }),
        ]);
        const printer = ts.createPrinter();

        return {
          code: printer.printFile(transformed.transformed[0]),
        };
      }

      return {
        code,
      };
    },
  };
}
