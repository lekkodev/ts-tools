import ts from "typescript";
import path from "path";
import { type LoaderDefinitionFunction, DefinePlugin } from "webpack";
import transformProgram, { readDotLekko } from "@lekko/ts-transformer";
import "./serialization";

export interface LekkoWebpackLoaderOptions {
  /**
   * Path to custom tsconfig file
   */
  tsconfigPath?: string;
  verbose?: boolean;
}

// Plugin to be used alongside loader for handling env vars
// TODO: This is only specific to Next.js right now, should be generalized eventually
// TODO: If possible, update so we only need to use the plugin which should be able to dynamically use the loader
export class LekkoEnvVarPlugin extends DefinePlugin {
  constructor(
    {
      prefix,
      lekkoConfPath,
    }: {
      /**
       * An optional prefix that will be prepended to each Lekko environment variable.
       * For example, passing "REACT_APP_" will give "REACT_APP_LEKKO_REPOSITORY_NAME".
       */
      prefix?: string;
      lekkoConfPath?: string;
    } = { lekkoConfPath: "." },
  ) {
    const dotLekko = readDotLekko(lekkoConfPath);
    const resolvedPrefix = prefix ?? "";

    const def = {
      [`process.env.${resolvedPrefix}LEKKO_REPOSITORY_OWNER`]: JSON.stringify(
        dotLekko.repoOwner,
      ),
      [`process.env.${resolvedPrefix}LEKKO_REPOSITORY_NAME`]: JSON.stringify(
        dotLekko.repoName,
      ),
    };

    super(def);
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
  const configFileName = path.join(
    this.rootContext,
    this.getOptions().tsconfigPath ?? "tsconfig.json",
  );
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
