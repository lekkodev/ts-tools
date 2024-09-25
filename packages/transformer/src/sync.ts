#!/usr/bin/env node
import path from "node:path";
import fs from "node:fs";
import { readDotLekko } from "./dotlekko";
import { Command } from "@commander-js/extra-typings";
import ts from "typescript";
import { FileDescriptorSet, createRegistryFromDescriptors } from "@bufbuild/protobuf";
import { LekkoParseError } from "./errors";
import { RepositoryContents, Namespace } from "./gen/lekko/feature/v1beta1/feature_pb";
import { checkConfigFunctionDeclaration } from "./transformer";
import { interfaceToMessageDescriptor, registerMessage, functionToProto } from "./ts-to-lekko";

const COMPILER_OPTIONS: ts.CompilerOptions = {
  noEmit: true,
};

/**
 * Parses TypeScript into a representation of config repository contents.
 * Expects a map of namespaces to corresponding TypeScript code file contents.
 */
export function syncSources(sourceMap: { [filename: string]: string }): RepositoryContents {
  // Create in-mem source files from source map
  const filenames = Object.keys(sourceMap);
  const sourceFileMap = Object.entries(sourceMap).reduce(
    (agg, [filename, source]) => {
      // TODO: Script target might need to be configurable
      const sourceFile = ts.createSourceFile(filename, source, ts.ScriptTarget.ES2015);
      agg[filename] = sourceFile;
      return agg;
    },
    {} as { [namespace: string]: ts.SourceFile },
  );

  // Alternate TS compiler host to not use disk fs
  const tsInstance = ts;
  const origHost = tsInstance.createCompilerHost(COMPILER_OPTIONS, true);
  const host: ts.CompilerHost = {
    fileExists: (fileName) => fileName in sourceFileMap,
    directoryExists: origHost.directoryExists?.bind(origHost),
    getSourceFile: (fileName) => sourceFileMap[fileName],
    getDefaultLibFileName: origHost.getDefaultLibFileName.bind(origHost),
    writeFile: origHost.writeFile.bind(origHost),
    getCurrentDirectory: origHost.getCurrentDirectory.bind(origHost),
    getCanonicalFileName: origHost.getCanonicalFileName.bind(origHost),
    useCaseSensitiveFileNames: origHost.useCaseSensitiveFileNames.bind(origHost),
    getNewLine: () => "\n",
    readFile: (fileName) => sourceMap[fileName],
  };

  const program = tsInstance.createProgram(filenames, COMPILER_OPTIONS, host);

  return syncInner(tsInstance, program, filenames);
}

/**
 * Parses TypeScript files in the specified location into a representation of config repository contents.
 */
export function sync(lekkoPath?: string): RepositoryContents {
  if (lekkoPath === undefined) {
    const dot = readDotLekko();
    lekkoPath = path.resolve(dot.lekkoPath);
  }
  const lekkoFiles: string[] = [];
  fs.readdirSync(lekkoPath).forEach((file) => {
    if (file.endsWith(".ts")) {
      lekkoFiles.push(`${lekkoPath}/${file}`);
    }
  });
  const tsInstance = ts;
  const program = tsInstance.createProgram(lekkoFiles, COMPILER_OPTIONS);

  return syncInner(tsInstance, program, lekkoFiles);
}

export function syncInner(tsInstance: typeof ts, program: ts.Program, filenames: string[]): RepositoryContents {
  const checker = program.getTypeChecker();

  // Repository contents will get gradually built up as files are processed
  const fds = newDefaultFileDescriptorSet();
  const repoContents = new RepositoryContents();

  function visitSourceFile(sourceFile: ts.SourceFile) {
    // e.g. src/lekko/default.ts -> default
    const namespace = path.basename(sourceFile.fileName, path.extname(sourceFile.fileName));

    // Visitor for first pass; collect type information and build up FDS
    function visitTypes(node: ts.Node): ts.Node | ts.Node[] | undefined {
      if (tsInstance.isInterfaceDeclaration(node)) {
        // Parse interface as message and register type
        const md = interfaceToMessageDescriptor(node);
        try {
          registerMessage(fds, namespace, md);
        } catch (e) {
          if (e instanceof Error) {
            throw new LekkoParseError(e.message, node);
          }
        }
      }
      return undefined;
    }

    tsInstance.visitEachChild(sourceFile, visitTypes, undefined);
    repoContents.fileDescriptorSet = fds;
    const typeRegistry = createRegistryFromDescriptors(fds);

    const namespaceProto = new Namespace({
      name: namespace,
    });

    // Visitor for second pass; translate functions and build up repo contents
    function visitFunctions(node: ts.Node): ts.Node | ts.Node[] | undefined {
      if (tsInstance.isFunctionDeclaration(node)) {
        const { checkedNode, configName, returnType } = checkConfigFunctionDeclaration(tsInstance, checker, node);
        const configProto = functionToProto(checkedNode, checker, namespace, configName, returnType, typeRegistry);
        namespaceProto.features.push(configProto);
      }
      return undefined;
    }

    tsInstance.visitEachChild(sourceFile, visitFunctions, undefined);
    repoContents.namespaces.push(namespaceProto);
  }

  program.getSourceFiles().forEach((sourceFile) => {
    if (filenames.includes(sourceFile.fileName)) {
      visitSourceFile(sourceFile);
    }
  });

  return repoContents;
}

/**
 * Create a new file descriptor set with well-known types included.
 * We bundle a prebuilt image of this base FDS with this library because
 * bufbuild/protobuf-es doesn't include these file descriptors for bundle size reasons.
 *
 * Included file descriptors:
 * - google/protobuf/wrappers.proto
 * - google/protobuf/struct.proto
 * - google/protobuf/duration.proto
 */
function newDefaultFileDescriptorSet(): FileDescriptorSet {
  try {
    const baseBin = fs.readFileSync(path.join(__dirname, "assets/image.binpb"));
    return FileDescriptorSet.fromBinary(baseBin);
  } catch (e) {
    if (e instanceof Error) {
      throw new Error(`Failed to create default file descriptor set: ${e.message}`);
    } else {
      throw e;
    }
  }
}

if (require.main === module) {
  process.on("uncaughtException", function (err) {
    console.error(err);
    process.exit(1);
  });

  const program = new Command()
    .description("Parse Lekko files and output the detected repository contents")
    .option("--lekko-files <paths>", "comma separated list of Lekko file paths, mutually exclusive with lekko-dir", (values: string) =>
      values.split(",").map((value) => value.trim()),
    )
    .option("--lekko-dir <string>", "path to directory with native Lekko files")
    .option("--json", "whether to output serialized repository contents in JSON instead of base64 binary");
  program.parse();
  const options = program.opts();
  const lekkoDir = options.lekkoDir;
  const filenames = options.lekkoFiles;

  let repoContents;
  if (filenames !== undefined) {
    const sourceMap = filenames.reduce(
      (agg, filename) => {
        const source = fs.readFileSync(filename, { encoding: "utf-8" });
        agg[filename] = source;
        return agg;
      },
      {} as { [filename: string]: string },
    );
    repoContents = syncSources(sourceMap);
  } else {
    repoContents = sync(lekkoDir);
  }

  if (repoContents.fileDescriptorSet === undefined) {
    throw new Error("Unexpected missing file descriptor set after sync");
  }
  const typeRegistry = createRegistryFromDescriptors(repoContents.fileDescriptorSet);

  if (options.json) {
    console.log(repoContents.toJsonString({ prettySpaces: 2, typeRegistry }));
  } else {
    const buf = Buffer.from(repoContents.toBinary());
    console.log(buf.toString("base64"));
  }
}
