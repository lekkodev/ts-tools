import { type Rollup, type Plugin, type PluginOption } from "vite";
import path from "node:path";
import ts from "typescript";
import transformProgram, { helpers, readDotLekko } from "@lekko/ts-transformer";

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
  /**
   * Relative path to a tsconfig.json file. Defaults to looking in the
   * current directory.
   */
  tsconfigPath?: string;
  verbose?: boolean;
}

// TODO: Investigate if this can be a compatible Rollup plugin instead
export default function (options: LekkoViteOptions = {}): PluginOption {
  const { apply, tsconfigPath = "./tsconfig.json", verbose } = options;

  // Parse tsconfig
  const configFileName = ts.findConfigFile(
    path.dirname(tsconfigPath),
    (path) => ts.sys.fileExists(path),
    path.basename(tsconfigPath),
  );
  if (configFileName === undefined) {
    throw new Error("Could not find tsconfig file.");
  }
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  const configFile = ts.readConfigFile(configFileName!, (path) =>
    ts.sys.readFile(path),
  );
  const compilerOptions = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    "./",
  );

  let tsProgram: ts.Program | undefined;

  const dotLekko = readDotLekko(".");

  return {
    name: "vite-plugin-lekko-typescript",
    enforce: "pre",
    apply: apply ?? "build",

    config() {
      return {
        define: {
          "import.meta.env.VITE_LEKKO_REPOSITORY_OWNER": JSON.stringify(
            dotLekko.repoOwner,
          ),
          "import.meta.env.VITE_LEKKO_REPOSITORY_NAME": JSON.stringify(
            dotLekko.repoName,
          ),
        },
      };
    },

    buildStart(_options) {
      // Create & transform program
      tsProgram = ts.createProgram(compilerOptions.fileNames, {
        ...compilerOptions.options,
        noEmit: true,
      });
      tsProgram = transformProgram.default(
        tsProgram,
        undefined,
        {
          target: "vite",
          configSrcPath: dotLekko.lekkoPath,
          verbose,
        },
        { ts },
      );
    },

    resolveId(source, importer) {
      if (tsProgram === undefined) {
        this.error(
          "Something went wrong with the Lekko plugin: TS program not found",
        );
      }
      if (helpers.isLekkoConfigFile(importer ?? "", dotLekko.lekkoPath)) {
        // Need to handle resolving proto binding imports - they're not on the FS
        if (source.endsWith("_pb.js")) {
          return path.resolve(
            path.join(dotLekko.lekkoPath, source.replace(/.js$/, ".ts")),
          );
        }
      }
      return null;
    },

    load(id): Rollup.LoadResult {
      if (tsProgram === undefined) {
        this.error(
          "Something went wrong with the Lekko plugin: TS program not found",
        );
      }
      // Load transformed code if available
      const loaded = tsProgram?.getSourceFile(id);
      if (loaded !== undefined) {
        return {
          code: loaded.getFullText(),
        };
      }
      return null;
    },
  };
}
