import { type Rollup, type Plugin, type PluginOption } from "vite";
import { spawnSync } from "child_process";

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
        // TODO: Try calling transpile explicitly instead
        const result = spawnSync("npx", ["print-transformed", "-f", id]);

        return {
          code: result.stdout.toString(),
        };
      }
      return {
        code,
      };
    },
  };
}
