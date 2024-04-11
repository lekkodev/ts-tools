import { type NextConfig } from "next";
import { type Configuration } from "webpack";
import lekko from "@lekko/webpack-loader";

export interface LekkoNextConfigOptions {
  verbose?: boolean;
  mode?: "development" | "production" | "all";
}

/**
 * Use this function to wrap the rest of your Next.js config object.
 *
 * This will allow Lekko's build tools to automatically transform local Lekko
 * config functions to code that can connect with Lekko's services if the
 * correct environment variables are present.
 */
export function withLekkoNextConfig(
  nextConfig: NextConfig,
  options?: LekkoNextConfigOptions,
): NextConfig {
  const { verbose = false, mode = "production" } = options ?? {};

  return {
    ...nextConfig,
    // Next.js doesn't give good types for Webpack config object, so we assume
    // Configuration type here which **should** be fine
    webpack: (config: Configuration, context) => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-assignment
      // const lekko = require("@lekko/webpack-loader");

      let webpackConfig = config;
      if (nextConfig.webpack != null) {
        webpackConfig = nextConfig.webpack(config, context) as Configuration;
      }
      if (webpackConfig.module === undefined) {
        webpackConfig.module = {
          rules: [],
        };
      }
      if (webpackConfig.module.rules === undefined) {
        webpackConfig.module.rules = [];
      }
      if (webpackConfig.plugins === undefined) {
        webpackConfig.plugins = [];
      }
      // TODO: Might need more investigation on how order of loaders works in Next
      if (mode === "all" || process.env.NODE_ENV === mode) {
        webpackConfig.module.rules.push({
          test: /lekko\/.*\.ts$/,
          loader: "@lekko/webpack-loader",
          options: {
            verbose,
          },
        });
        webpackConfig.plugins.push(
          // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
          new lekko.LekkoEnvVarPlugin({ target: "next" }),
        );
      }
      return config;
    },
  };
}
