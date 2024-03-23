import ts from "typescript";
import transformProgram from "@lekko/ts-transformer";


module.exports = function (source: string) {
  /*
  // Parse tsconfig
  const configFileName = "/Users/jonathan/src/nextjs-dashboard/tsconfig.json"
  if (configFileName === undefined) {
    throw new Error("Could not find tsconfig file.");
  }
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  const configFile = ts.readConfigFile(configFileName!, (path) =>
    ts.sys.readFile(path),
  );
  const compilerOptions = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    "./",
  );
  */

  // @ts-ignore
  console.log(this.resource);
  console.log(source);
  // @ts-ignore
  let tsProgram = ts.createProgram([this.resource], {
    undefined,
    noEmit: true,
  });
  tsProgram = transformProgram(
    tsProgram,
    undefined,
    {
      // @ts-ignore
      target: "next",
      // Already being emitted above during init
      emitEnv: false,
      //configSrcPath,
    },
    { ts },
  );
  // @ts-ignore
  console.log(tsProgram?.getSourceFile(this.resource)?.getFullText());
  // @ts-ignore
  return tsProgram?.getSourceFile(this.resource)?.getFullText();
  //const sourceFile = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest);

   // @ts-ignore
  //const transformed = ts.transform(sourceFile, [  transformer ]);


  //return transformed

}
