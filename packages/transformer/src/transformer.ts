import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { type ProgramTransformerExtras, type TransformerExtras } from "ts-patch";
import ts from "typescript";
import { type ProtoFileBuilder, type LekkoConfigJSON, type LekkoTransformerOptions } from "./types";
import { type CheckedFunctionDeclaration, LEKKO_FILENAME_REGEX, assertIsCheckedFunctionDeclaration, isLekkoConfigFile } from "./helpers";
import {
  handleInterfaceAsProto,
  genProtoFile,
  functionToConfigJSON,
  genStarlark,
  listConfigs,
  removeConfig,
  handleFunctionParamsAsProtos,
} from "./ts-to-lekko";
import { patchCompilerHost, patchProgram } from "./patch";
import kebabCase from "lodash.kebabcase";
import { LekkoParseError } from "./errors";
import { readDotLekko } from "./dotlekko";

const CTX_IDENTIFIER_NAME = "_ctx";
const EXCEPTION_IDENTIFIER_NAME = "e";
const CLIENT_IDENTIFIER_NAME = "_client";

export function getRepoPathFromCLI(): string {
  const repoCmd = spawnSync("lekko", ["repo", "path"], { encoding: "utf-8" });
  if (repoCmd.error !== undefined || repoCmd.status !== 0) {
    return path.join(os.homedir(), "Library/Application Support/Lekko/Config Repositories/default/");
  }
  return repoCmd.stdout.trim();
}

/**
 * Generate Proto and Starlark from Typescript and then regenerate Typescript back
 */
export function twoWaySync(program: ts.Program, pluginConfig: LekkoTransformerOptions, extras?: TransformerExtras) {
  const { repoPath = "" } = pluginConfig;
  const dot = readDotLekko();
  const lekkoPath = path.resolve(dot.lekkoPath);
  // FIXME: Remove - no need for this with dotlekko
  const lekkoSourceFiles = program.getSourceFiles().filter((sourceFile) => isLekkoConfigFile(sourceFile.fileName, lekkoPath));
  if (lekkoSourceFiles.length === 0) {
    console.warn(`[@lekko/ts-transformer] No Lekko files found at "${dot.lekkoPath}"`);
  }

  const tsInstance = extras?.ts ?? ts;
  const checker = program.getTypeChecker();

  const protoFileBuilder: ProtoFileBuilder = { messages: {}, enums: {} };
  const configs: LekkoConfigJSON[] = [];

  function visitSourceFile(sourceFile: ts.SourceFile) {
    // e.g. src/lekko/default.ts -> default
    const namespace = path.basename(sourceFile.fileName, path.extname(sourceFile.fileName));

    function visit(node: ts.Node): ts.Node | ts.Node[] | undefined {
      if (tsInstance.isSourceFile(node)) {
        tsInstance.visitEachChild(node, visit, undefined);
        try {
          // The following are per-file operations
          const configSet = new Set(listConfigs(repoPath, namespace));
          genProtoFile(node, repoPath, protoFileBuilder);
          configs.forEach((config) => {
            genStarlark(repoPath, namespace, config);
            // If used to gen starlark, don't remove in cleanup
            configSet.delete(config.key);
          });
          // Remove leftover configs that weren't in ns file
          // TODO: Batch remove in CLI
          configSet.forEach((configKey) => {
            try {
              removeConfig(repoPath, namespace, configKey);
            } catch (e) {
              // Failing to remove is fine, log but ignore
              if (e instanceof Error) {
                console.log(`[@lekko/ts-transformer] Failed to remove config ${namespace}/${configKey}: ${e.message}`);
              }
            }
          });

          const genTSCmd = spawnSync("lekko", ["gen", "ts", "-n", namespace, "-r", repoPath], {
            encoding: "utf-8",
          });
          if (genTSCmd.error !== undefined || genTSCmd.status !== 0) {
            throw new Error(`Failed to generate TS:\n${genTSCmd.stdout}`);
          }
        } catch (e) {
          if (pluginConfig.verbose === true && e instanceof Error) {
            console.log(`[@lekko/ts-transformer] ${e.message}`);
          } else {
            console.log("[@lekko/ts-transformer] CLI tools missing, skipping proto and starlark generation.");
          }
        }
      } else if (tsInstance.isFunctionDeclaration(node)) {
        const { checkedNode, configName, returnType } = checkConfigFunctionDeclaration(tsInstance, checker, node);
        // Apply changes to config repo
        const configJSON = functionToConfigJSON(checkedNode, checker, namespace, configName, returnType);
        configs.push(configJSON);
        handleFunctionParamsAsProtos(checkedNode, checker, protoFileBuilder);
      } else if (tsInstance.isInterfaceDeclaration(node)) {
        handleInterfaceAsProto(node, checker, protoFileBuilder);
      }
      return undefined;
    }

    ts.visitNode(sourceFile, visit);
  }

  lekkoSourceFiles.forEach((sourceFile) => {
    visitSourceFile(sourceFile);
  });
}

export default function transformProgram(
  program: ts.Program,
  host?: ts.CompilerHost,
  pluginConfig?: LekkoTransformerOptions,
  extras?: ProgramTransformerExtras,
) {
  pluginConfig = pluginConfig ?? {};
  pluginConfig.repoPath ||= getRepoPathFromCLI();
  const dot = readDotLekko();
  const lekkoPath = path.resolve(dot.lekkoPath);

  const compilerOptions = program.getCompilerOptions();
  const tsInstance = extras?.ts ?? ts;
  const rootFileNames = program.getRootFileNames().map(tsInstance.normalizePath);
  const compilerHost = host ?? tsInstance.createCompilerHost(compilerOptions, true);

  // Patch host to make the generated and transformed source files available
  const sfCache = new Map<string, ts.SourceFile>();
  patchCompilerHost(compilerHost, sfCache);

  // We run our source transformer on existing source files first.
  const lekkoSourceFiles = program.getSourceFiles().filter((sourceFile) => isLekkoConfigFile(sourceFile.fileName, lekkoPath));

  const transformerExtras: TransformerExtras = {
    ts: tsInstance,
    library: "typescript",
    addDiagnostic: () => 0,
    removeDiagnostic: () => {},
    diagnostics: [],
  };

  // FIXME: Remove
  // twoWaySync(program, pluginConfig, transformerExtras);

  // let updatedProgram = tsInstance.createProgram([...rootFileNames, ...sfCache.keys()], compilerOptions, compilerHost);
  console.log("dbg// root file names", rootFileNames);
  const transformedSources = tsInstance.transform(
    lekkoSourceFiles,
    [
      // TODO: restructure source transformer
      transformer(program, pluginConfig, transformerExtras),
    ],
    compilerOptions,
  ).transformed;

  // Then, we need to add the transformed source files to the program
  const printer = tsInstance.createPrinter();
  transformedSources.forEach((sourceFile) => {
    const printed = printer.printFile(sourceFile);

    sfCache.set(sourceFile.fileName, tsInstance.createSourceFile(sourceFile.fileName, printed, sourceFile.languageVersion));
  });
  // We need to add these bindings to the program
  const updatedProgram = tsInstance.createProgram([...rootFileNames, ...sfCache.keys()], compilerOptions, compilerHost);

  // Patch updated program to cleanly handle diagnostics and such
  patchProgram(updatedProgram);

  return updatedProgram;
}

export function checkConfigFunctionDeclaration(
  tsInstance: typeof ts,
  checker: ts.TypeChecker,
  node: ts.FunctionDeclaration,
): {
  checkedNode: CheckedFunctionDeclaration;
  configName: string;
  returnType: ts.Type;
} {
  assertIsCheckedFunctionDeclaration(node);
  // Check name
  const functionName = node.name.getFullText().trim();
  if (!/^\s*get[A-Z][A-Za-z]*$/.test(functionName)) {
    throw new LekkoParseError(`Unparsable function name "${functionName}": lekko function names must start with "get"`, node);
  }
  const configName = kebabCase(functionName.substring(3));
  // Check return type
  if (tsInstance.isAsyncFunction(node)) {
    throw new LekkoParseError("Lekko functions must not be async", node);
  }
  const returnType = checker.getTypeFromTypeNode(node.type);
  if (returnType.getSymbol()?.escapedName?.toString() === "Array") {
    throw new LekkoParseError("Array return types are currently not supported", node);
  }

  return { checkedNode: node, configName, returnType };
}

export function transformer(program: ts.Program, pluginConfig?: LekkoTransformerOptions, extras?: TransformerExtras) {
  const tsInstance = extras?.ts ?? ts;

  const checker = program.getTypeChecker();

  return (context: ts.TransformationContext) => {
    const { factory } = context;

    function transformLocalToRemote(
      node: CheckedFunctionDeclaration,
      namespace: string,
      configName: string,
      returnType: ts.Type,
      // We work with parsing the JSON representations of config protos for now
      // It's probably slower but less dependencies to worry about and still "typed"
      config: LekkoConfigJSON,
    ): ts.Node | ts.Node[] {
      return [
        factory.updateFunctionDeclaration(
          node,
          node.modifiers,
          node.asteriskToken,
          node.name,
          node.typeParameters,
          [
            factory.createParameterDeclaration(
              undefined,
              undefined,
              CTX_IDENTIFIER_NAME,
              factory.createToken(tsInstance.SyntaxKind.QuestionToken),
              undefined,
              undefined,
            ),
            // Pass client as second parameter (in body, also try to get global client)
            factory.createParameterDeclaration(undefined, undefined, factory.createIdentifier(CLIENT_IDENTIFIER_NAME), undefined, undefined, undefined),
          ],
          node.type,
          wrapTryCatch(
            factory.createBlock(
              [
                factory.createReturnStatement(
                  factory.createCallExpression(
                    factory.createPropertyAccessExpression(factory.createIdentifier("lekko"), factory.createIdentifier("get")),
                    undefined,
                    [
                      factory.createStringLiteral(namespace),
                      factory.createStringLiteral(configName),
                      factory.createIdentifier(CTX_IDENTIFIER_NAME),
                      factory.createIdentifier(CLIENT_IDENTIFIER_NAME),
                    ],
                  ),
                ),
              ],
              true,
            ),
            addDebugLogs(namespace, configName, prependParamVars(node, CTX_IDENTIFIER_NAME, node.body)),
          ),
        ),
        factory.createExpressionStatement(
          factory.createBinaryExpression(
            factory.createPropertyAccessExpression(node.name, factory.createIdentifier("_namespaceName")),
            factory.createToken(tsInstance.SyntaxKind.EqualsToken),
            factory.createStringLiteral(namespace),
          ),
        ),
        factory.createExpressionStatement(
          factory.createBinaryExpression(
            factory.createPropertyAccessExpression(node.name, factory.createIdentifier("_configName")),
            factory.createToken(tsInstance.SyntaxKind.EqualsToken),
            factory.createStringLiteral(configName),
          ),
        ),
        factory.createExpressionStatement(
          factory.createBinaryExpression(
            factory.createPropertyAccessExpression(node.name, factory.createIdentifier("_evaluationType")),
            factory.createToken(tsInstance.SyntaxKind.EqualsToken),
            factory.createStringLiteral(config.type),
          ),
        ),
      ];
    }

    function addDebugLogs(ns: string, name: string, block: ts.Block): ts.Block {
      const statements: ts.Statement[] = [
        factory.createExpressionStatement(
          factory.createCallExpression(factory.createPropertyAccessExpression(factory.createIdentifier("lekko"), factory.createIdentifier("log")), undefined, [
            factory.createStringLiteral(`[lekko] Failed to evaluate ${ns}/${name}: `),
            factory.createIdentifier(EXCEPTION_IDENTIFIER_NAME),
          ]),
        ),
        factory.createExpressionStatement(
          factory.createCallExpression(factory.createPropertyAccessExpression(factory.createIdentifier("lekko"), factory.createIdentifier("log")), undefined, [
            factory.createStringLiteral(`[lekko] Using in-code fallback for ${ns}/${name}.`),
          ]),
        ),
      ];
      statements.push(...block.statements);
      return factory.createBlock(statements);
    }

    // Prepend the given body with a variable assignment to make the function's parameters available
    // in the body. No-op if there was no parameter to start.
    // i.e. adds `_ctx ??= {}; const { env } = _ctx ?? {}` to start
    function prependParamVars(fd: ts.FunctionDeclaration, newParamName: string, body: ts.Block): ts.Block {
      const statements: ts.Statement[] = [
        factory.createExpressionStatement(
          factory.createBinaryExpression(
            factory.createIdentifier(newParamName),
            factory.createToken(tsInstance.SyntaxKind.QuestionQuestionEqualsToken),
            factory.createObjectLiteralExpression(),
          ),
        ),
      ];
      // Get original first parameter to function
      const param = fd.parameters[0]?.getChildAt(0); // GetChild for discarding type info
      if (param !== undefined) {
        statements.push(
          factory.createVariableStatement(
            undefined,
            factory.createVariableDeclarationList([
              factory.createVariableDeclaration(
                // This is technically probably not a good way to destructure
                param.getFullText(),
                undefined,
                undefined,
                factory.createIdentifier(newParamName),
              ),
            ]),
          ),
        );
      }
      statements.push(...body.statements);
      return factory.createBlock(statements);
    }

    // Use for handling static fallback
    function wrapTryCatch(tryBlock: ts.Block, catchBlock: ts.Block): ts.Block {
      return factory.createBlock([
        factory.createTryStatement(
          tryBlock,
          factory.createCatchClause(
            factory.createVariableDeclaration(factory.createIdentifier(EXCEPTION_IDENTIFIER_NAME), undefined, undefined, undefined),
            catchBlock,
          ),
          undefined,
        ),
      ]);
    }

    // e.g. import * as lekko from "@lekko/js-sdk"
    function addLekkoImports(sourceFile: ts.SourceFile): ts.SourceFile {
      return factory.updateSourceFile(sourceFile, [
        factory.createImportDeclaration(
          undefined,
          factory.createImportClause(false, undefined, factory.createNamespaceImport(factory.createIdentifier("lekko"))),
          factory.createStringLiteral("@lekko/js-sdk"),
          undefined,
        ),
        ...sourceFile.statements,
      ]);
    }

    return (sourceFile: ts.SourceFile): ts.SourceFile => {
      const namespace = path.basename(sourceFile.path, path.extname(sourceFile.path));

      function visit(node: ts.Node): ts.Node | ts.Node[] | undefined {
        if (tsInstance.isSourceFile(node)) {
          const match = node.fileName.match(LEKKO_FILENAME_REGEX);
          if (match) {
            let transformed = addLekkoImports(node);
            transformed = tsInstance.visitEachChild(transformed, visit, context);
            return transformed;
          } else {
            return node;
          }
        } else if (tsInstance.isFunctionDeclaration(node)) {
          const { checkedNode, configName, returnType } = checkConfigFunctionDeclaration(tsInstance, checker, node);
          const configJSON = functionToConfigJSON(checkedNode, checker, namespace, configName, returnType);
          // Transform local (static) to SDK client calls
          return transformLocalToRemote(checkedNode, namespace, configName, returnType, configJSON);
        }
        return node;
      }
      const visited = tsInstance.visitNode(sourceFile, visit) as ts.SourceFile;

      if (pluginConfig?.verbose) {
        const printer = tsInstance.createPrinter();
        console.log("-".repeat(12 + sourceFile.fileName.length));
        console.log(`Transformed ${sourceFile.fileName}:`);
        console.log("-".repeat(12 + sourceFile.fileName.length));
        console.log(printer.printFile(visited));
        console.log("-".repeat(12 + sourceFile.fileName.length));
      }

      return visited;
    };
  };
}
