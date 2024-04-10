import ts from "typescript";
import path from "path";
import { type LoaderDefinitionFunction, DefinePlugin } from "webpack";
import transformProgram, { emitEnvVars } from "@lekko/ts-transformer";
import "./serialization";

export interface LekkoWebpackLoaderOptions {
  verbose?: boolean;
}

// Plugin to be used alongside loader for handling env vars
// TODO: This is only specific to Next.js right now, should be generalized eventually
export class LekkoEnvVarPlugin extends DefinePlugin {
  constructor({
    target,
    prefix,
  }: {
    /**
     * Target "platform" for this plugin. If specified, the env vars will be named
     * such that they can be picked up by the build tools for frontend usage.
     * For example, for `next`, env vars will be prefixed with `NEXT_PUBLIC_`.
     *
     * If none of the targets suit your project, see `prefix`.
     */
    target?: "node" | "vite" | "next";
    /**
     * If the preset `target`s are not suitable for your project, you can pass an
     * optional prefix that will be prepended to each Lekko environment variable.
     * For example, passing "REACT_APP_" will give "REACT_APP_LEKKO_API_KEY".
     */
    prefix?: string;
  } = {}) {
    let lekkoVars;
    try {
      lekkoVars = emitEnvVars(target, ".env.local", prefix);
    } catch (e) {
      console.log(
        "[LekkoEnvVarPlugin] No Lekko env information found on device, skipping",
      );
      super({});
      return;
    }

    const definitions = Object.entries(lekkoVars).reduce(
      (agg, [key, value]) => {
        agg[`process.env.${key}`] = JSON.stringify(value);
        return agg;
      },
      {} as Record<string, string>,
    );
    super(definitions);
  }
}

type LekkoWebpackModule =
  LoaderDefinitionFunction<LekkoWebpackLoaderOptions> & {
    LekkoEnvVarPlugin: typeof LekkoEnvVarPlugin;
  };

const loader: LekkoWebpackModule = function (source) {
  // Ignore generated files
  if (this.resource.split(path.sep).includes("gen")) {
    return source;
  }
  // Parse ts config options
  const configFileName = path.join(this.rootContext, "tsconfig.json");
  const configFile = ts.readConfigFile(configFileName, (path) =>
    ts.sys.readFile(path),
  );
  const compilerOptions = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    this.rootContext,
  );
  // Resource gives path to Lekko config source file
  const resource = this.resource;
  // Invoke transformer
  const program = ts.createProgram([resource], { ...compilerOptions.options });
  const transformed = transformProgram(program, undefined, {
    target: "next",
    configSrcPath: path.dirname(resource),
    emitEnv: false,
    verbose: this.getOptions().verbose,
  });
  const srcFile = transformed.getSourceFile(resource);
  if (srcFile === undefined) {
    this.emitWarning(
      new Error("Error setting up Lekko Webpack loader, defaulting to no-op"),
    );
    return source;
  }

  const printer = ts.createPrinter();
  return printer.printFile(srcFile);
};

loader.LekkoEnvVarPlugin = LekkoEnvVarPlugin;

module.exports = loader;
