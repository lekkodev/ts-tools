import { type NextConfig } from "next";
import { type Configuration } from "webpack";
import { LekkoPlugin } from "@lekko/webpack-loader";

export interface LekkoNextConfigOptions {
  verbose?: boolean;
}

/**
 * Use this function to wrap the rest of your Next.js config object.
 *
 * This will allow Lekko's build tools to automatically transform local Lekko
 * config functions to code that can connect with Lekko's services if the
 * correct environment variables are present.
 */
export function withLekkoNextConfig(nextConfig: NextConfig, options?: LekkoNextConfigOptions): NextConfig {
  const { verbose = false } = options ?? {};

  return {
    ...nextConfig,
    // Next.js doesn't give good types for Webpack config object, so we assume
    // Configuration type here which **should** be fine
    webpack: (config: Configuration, context) => {
      let webpackConfig = config;
      if (nextConfig.webpack != null) {
        webpackConfig = nextConfig.webpack(config, context) as Configuration;
      }
      if (webpackConfig.plugins === undefined) {
        webpackConfig.plugins = [];
      }
      webpackConfig.plugins.push(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        new LekkoPlugin({ prefix: "NEXT_PUBLIC_", verbose }),
      );
      return config;
    },
  };
}
