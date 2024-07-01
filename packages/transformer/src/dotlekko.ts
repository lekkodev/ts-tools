import * as fs from "fs";
import pathlib from "node:path";
import YAML from "yaml";
import { LekkoConfError } from "./errors";

export interface DotLekko {
  version: string;
  repoOwner: string;
  repoName: string;
  lekkoPath: string;
}

/**
 * Looks for, reads, and parses a dotlekko file in the given path.
 * e.g. If "." is passed, will look for ./.lekko, ./.lekko.yaml, ./.lekko.yml.
 */
export function readDotLekko(path: string = "."): DotLekko {
  const barePath = pathlib.join(path, ".lekko");
  const yamlPath = pathlib.join(path, ".lekko.yaml");
  const ymlPath = pathlib.join(path, ".lekko.yml");

  const bareMissing = fs.existsSync(barePath);
  const yamlMissing = fs.existsSync(yamlPath);
  const ymlMissing = fs.existsSync(ymlPath);

  if (bareMissing && yamlMissing && ymlMissing) {
    throw new LekkoConfError(`Lekko configuration file not found in ${path}`);
  }
  const dotLekkoPath = bareMissing ? (yamlMissing ? ymlPath : yamlPath) : barePath;

  const f = fs.readFileSync(dotLekkoPath, "utf-8");
  const parsed = YAML.parse(f) as Record<string, string | undefined>;

  if (parsed["version"] !== "v1") {
    throw new LekkoConfError(`Unsupported Lekko configuration file version ${parsed["version"]}`);
  }
  const version = parsed["version"];
  if (parsed["repository"] === "" || parsed["repository"] === undefined) {
    throw new LekkoConfError(`Missing field "repository" in Lekko configuration file`);
  } else if (parsed["repository"].split("/").length !== 2) {
    throw new LekkoConfError(`Invalid format for "repository" in Lekko configuration file: must be <repo_owner>/<repo_name>`);
  }
  const [repoOwner, repoName] = parsed["repository"].split("/");
  if (parsed["lekko_path"] === "" || parsed["lekko_path"] === undefined) {
    throw new LekkoConfError(`Missing field "lekko_path" in Lekko configuration file`);
  }
  const lekkoPath = parsed["lekko_path"];

  return {
    version,
    repoOwner,
    repoName,
    lekkoPath,
  };
}
