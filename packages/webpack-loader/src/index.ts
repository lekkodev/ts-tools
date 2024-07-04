import path from "path";
import { DefinePlugin, type Compiler, NormalModule } from "webpack";
import { type DotLekko, readDotLekko } from "@lekko/ts-transformer";
import "./serialization";

// Plugin to be used alongside loader for handling env vars
export class LekkoPlugin extends DefinePlugin {
  dotLekko: DotLekko;
  verbose: boolean;

  constructor({
    prefix,
    lekkoConfPath,
    verbose,
  }: {
    /**
     * An optional prefix that will be prepended to each Lekko environment variable.
     * For example, passing "REACT_APP_" will give "REACT_APP_LEKKO_REPOSITORY_NAME".
     */
    prefix?: string;
    lekkoConfPath?: string;
    verbose?: boolean;
  }) {
    const dotLekko = readDotLekko(lekkoConfPath);
    const resolvedPrefix = prefix ?? "";

    const def = {
      [`process.env.${resolvedPrefix}LEKKO_REPOSITORY_OWNER`]: JSON.stringify(dotLekko.repoOwner),
      [`process.env.${resolvedPrefix}LEKKO_REPOSITORY_NAME`]: JSON.stringify(dotLekko.repoName),
    };

    super(def);
    this.dotLekko = dotLekko;
    this.verbose = verbose ?? false;
  }

  override apply(compiler: Compiler) {
    super.apply(compiler);

    // Automatically add the Lekko loader for ease of use
    compiler.hooks.compilation.tap("LekkoPlugin", (compilation) => {
      NormalModule.getCompilationHooks(compilation).beforeLoaders.tap("LekkoPlugin", (loaders) => {
        loaders.push({
          loader: path.resolve(__dirname, "loader.js"),
          options: {
            lekkoPath: this.dotLekko.lekkoPath,
            verbose: this.verbose,
          },
          ident: null,
          type: null,
        });
      });
    });
  }
}
