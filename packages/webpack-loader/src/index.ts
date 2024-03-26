import ts from "typescript";
import path from "path";
import { type LoaderDefinitionFunction } from "webpack";
import transformProgram from "@lekko/ts-transformer";

const loader: LoaderDefinitionFunction = function (source) {
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

module.exports = loader;
