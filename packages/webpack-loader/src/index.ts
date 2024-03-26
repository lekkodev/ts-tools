import ts from "typescript";
import path from "path";
import { transformer } from "@lekko/ts-transformer";

module.exports = function (source: string) {
  // @ts-ignore
  const configFileName = path.join(this.rootContext, "tsconfig.json")
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  const configFile = ts.readConfigFile(configFileName!, (path) =>
    ts.sys.readFile(path),
  );

  const compilerOptions = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    // @ts-ignore
    this.rootContext,
  );

  // @ts-ignore
  const resource = this.resource;

  // @ts-ignore
  let program = ts.createProgram([resource], compilerOptions);

  const transformedSources = ts.transform(
    [program?.getSourceFile(resource)!],
    [
      transformer(program, { target: "next" }, {
        ts,
        library: "typescript",
        addDiagnostic: () => 0,
        removeDiagnostic: () => { },
        diagnostics: [],
      }),
    ],
    {},
  ).transformed;
  const printer = ts.createPrinter();
  return printer.printFile(transformedSources[0])
};
