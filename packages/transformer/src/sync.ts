#!/usr/bin/env node
import path from "node:path";
import fs from "node:fs";
import { readDotLekko } from "./dotlekko";
import { Command } from "@commander-js/extra-typings";
import ts from "typescript";
import { FileDescriptorSet, createRegistryFromDescriptors } from "@bufbuild/protobuf";
import { LekkoParseError } from "./errors";
import { RepositoryContents, Namespace } from "./gen/lekko/feature/v1beta1/feature_pb";
import { isLekkoConfigFile } from "./helpers";
import { checkConfigFunctionDeclaration } from "./transformer";
import { interfaceToMessageDescriptor, registerMessage, functionToProto } from "./ts-to-lekko";

/**
 * Parse TypeScript into a representation of config repository contents
 */
// TODO: Refactor to take individual files or file contents directly for testability
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
  const program = tsInstance.createProgram(lekkoFiles, { noEmit: true });
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

    const namespaceProto = new Namespace({});

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
    if (isLekkoConfigFile(sourceFile.fileName, lekkoPath)) {
      visitSourceFile(sourceFile);
    }
  });

  return repoContents;
}

/**
 * Create a new file descriptor set with well-known types included.
 * We bundle a prebuilt image of this base FDS with this library because
 * bufbuild/protobuf-es doesn't include these file descriptor for bundle size reasons.
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
    .option("--lekko-dir <string>", "path to directory with native Lekko files")
    .option("--json", "whether to output serialized repository contents in JSON instead of binary");
  program.parse();
  const options = program.opts();
  const lekkoDir = options.lekkoDir;

  const repoContents = sync(lekkoDir);
  if (repoContents.fileDescriptorSet === undefined) {
    throw new Error("Unexpected missing file descriptor set after sync");
  }
  const typeRegistry = createRegistryFromDescriptors(repoContents.fileDescriptorSet);

  if (options.json) {
    console.log(repoContents.toJsonString({ prettySpaces: 2, typeRegistry }));
  } else {
    const buf = Buffer.from(repoContents.toBinary());
    console.log(buf.toString("utf-8"));
  }
}
