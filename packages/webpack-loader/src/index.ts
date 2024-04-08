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
class LekkoEnvVarPlugin extends DefinePlugin {
  constructor() {
    // No-op if relevant env vars already exist
    if (
      process.env.NEXT_PUBLIC_LEKKO_API_KEY !== undefined ||
      process.env.NEXT_PUBLIC_LEKKO_REPOSITORY_OWNER !== undefined ||
      process.env.NEXT_PUBLIC_LEKKO_REPOSITORY_NAME !== undefined
    ) {
      super({});
      return;
    }

    let lekkoVars;
    try {
      lekkoVars = emitEnvVars("next", ".env.local");
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
