import assert from "assert";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import {
  type ProgramTransformerExtras,
  type TransformerExtras,
} from "ts-patch";
import ts from "typescript";
import {
  type ProtoFileBuilder,
  type LekkoConfigJSON,
  type LekkoTransformerOptions,
} from "./types";
import {
  type CheckedFunctionDeclaration,
  LEKKO_FILENAME_REGEX,
  isCheckedFunctionDeclaration,
  isLekkoConfigFile,
} from "./helpers";
import {
  checkCLIDeps,
  interfaceToProto,
  genProtoBindings,
  genProtoFile,
  functionToConfigJSON,
  genStarlark,
} from "./ts-to-lekko";
import { patchCompilerHost, patchProgram } from "./patch";
import { emitEnvVars } from "./emit-env-vars";
import kebabCase from "lodash.kebabcase";

const CONFIG_IDENTIFIER_NAME = "_config";
const CTX_IDENTIFIER_NAME = "_ctx";

function getRepoPathFromCLI(): string {
  const repoCmd = spawnSync("lekko", ["repo", "path"], { encoding: "utf-8" });
  if (repoCmd.error !== undefined || repoCmd.status !== 0) {
    return path.join(
      os.homedir(),
      "Library/Application Support/Lekko/Config Repositories/default/",
    );
  }
  return repoCmd.stdout.trim();
}

export default function transformProgram(
  program: ts.Program,
  host?: ts.CompilerHost,
  pluginConfig?: LekkoTransformerOptions,
  extras?: ProgramTransformerExtras,
) {
  pluginConfig = pluginConfig ?? {};
  pluginConfig.repoPath ||= getRepoPathFromCLI();
  const {
    repoPath = "",
    configSrcPath = "./src/lekko",
    emitEnv = true,
    target = "node",
  } = pluginConfig ?? {};
  const resolvedConfigSrcPath = path.resolve(configSrcPath);

  const compilerOptions = program.getCompilerOptions();
  const tsInstance = extras?.ts ?? ts;
  const rootFileNames = program
    .getRootFileNames()
    .map(tsInstance.normalizePath);
  const compilerHost =
    host ?? tsInstance.createCompilerHost(compilerOptions, true);

  // Patch host to make the generated and transformed source files available
  const sfCache = new Map<string, ts.SourceFile>();
  patchCompilerHost(compilerHost, sfCache);

  // We run our source transformer on existing source files first.
  // As a side effect, this pushes configs generated from Lekko-TS files to the
  // local config repo (starlark + protos).
  const lekkoSourceFiles = program
    .getSourceFiles()
    .filter((sourceFile) =>
      isLekkoConfigFile(sourceFile.fileName, resolvedConfigSrcPath),
    );

  const transformedSources = tsInstance.transform(
    lekkoSourceFiles,
    [
      // TODO: restructure source transformer
      transformer(program, pluginConfig, {
        ts: tsInstance,
        library: "typescript",
        addDiagnostic: () => 0,
        removeDiagnostic: () => {},
        diagnostics: [],
      }),
    ],
    compilerOptions,
  ).transformed;
  // Then, we need to generate proto bindings and add the generated + transformed source files to the program
  const printer = tsInstance.createPrinter();
  transformedSources.forEach((sourceFile) => {
    const namespace = path.basename(
      sourceFile.fileName,
      path.extname(sourceFile.fileName),
    );

    sfCache.set(
      sourceFile.fileName,
      tsInstance.createSourceFile(
        sourceFile.fileName,
        printer.printFile(sourceFile),
        sourceFile.languageVersion,
      ),
    );
    try {
      const genIter = genProtoBindings(repoPath, configSrcPath, namespace);
      genIter.next();
      const generated = genIter.next();
      if (!generated.done) {
        Object.entries(generated.value).forEach(([fileName, contents]) => {
          sfCache.set(
            path.join(resolvedConfigSrcPath, fileName),
            tsInstance.createSourceFile(
              path.join(resolvedConfigSrcPath, fileName),
              contents,
              ts.ScriptTarget.ES2017,
            ),
          );
        });
        // Trigger cleanup (TODO: probably doesn't need to be a generator)
        genIter.next();
      }
    } catch (e) {
      let msg = "Failed to generate proto bindings, continuing";
      if (pluginConfig?.verbose == true && e instanceof Error) {
        msg = `${msg}: ${e.message}`;
      }
      console.warn(msg);
    }
  });
  // We need to add these bindings to the program
  const updatedProgram = tsInstance.createProgram(
    [...rootFileNames, ...sfCache.keys()],
    compilerOptions,
    compilerHost,
  );

  // Patch updated program to cleanly handle diagnostics and such
  patchProgram(updatedProgram);

  // Emit env vars
  if (emitEnv) {
    try {
      emitEnvVars(
        target,
        typeof emitEnv === "string"
          ? emitEnv
          : // NextJS conventions are to use .env.local by default for local work
            target === "next"
            ? ".env.local"
            : ".env",
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : e;
      console.warn("[@lekko/ts-transformer]", msg);
    }
  }

  return updatedProgram;
}

export function transformer(
  program: ts.Program,
  pluginConfig?: LekkoTransformerOptions,
  extras?: TransformerExtras,
) {
  const tsInstance = extras?.ts ?? ts;
  const { target = "node", repoPath = "" } = pluginConfig ?? {};

  const checker = program.getTypeChecker();

  return (context: ts.TransformationContext) => {
    const { factory } = context;
    let hasImportProto = false;

    function checkConfigFunctionDeclaration(node: ts.FunctionDeclaration): {
      checkedNode: CheckedFunctionDeclaration;
      configName: string;
      returnType: ts.Type;
    } {
      const sig = checker.getSignatureFromDeclaration(node);
      assert(sig);
      if (!isCheckedFunctionDeclaration(node)) {
        throw new Error("Invalid function declaration: missing name or body");
      }
      // Check name
      const functionName = node.name.getFullText().trim();
      if (!/^\s*get[A-Z][A-Za-z]*$/.test(functionName)) {
        throw new Error(
          `Unparsable function name "${functionName}": config function names must start with "get"`,
        );
      }
      const configName = kebabCase(functionName.substring(3));
      // Check return type
      const isAsync = ts.isAsyncFunction(node);
      if (target === "node" && !isAsync) {
        throw new Error("Config function must be async if target is node");
      } else if (isAsync) {
        throw new Error(
          `Config function must not be async if target is ${target}`,
        );
      }
      const returnType =
        target === "node"
          ? checker.getPromisedTypeOfPromise(sig.getReturnType())
          : sig.getReturnType();
      assert(returnType, "Unable to parse return type");

      return { checkedNode: node, configName, returnType };
    }

    function transformLocalToRemote(
      node: CheckedFunctionDeclaration,
      namespace: string,
      configName: string,
      returnType: ts.Type,
      // We work with parsing the JSON representations of config protos for now
      // It's probably slower but less dependencies to worry about and still "typed"
      config: LekkoConfigJSON,
    ): ts.Node | ts.Node[] {
      let getter: string | undefined = undefined;

      if (returnType.flags & tsInstance.TypeFlags.String) {
        getter = "getString";
      } else if (returnType.flags & tsInstance.TypeFlags.Number) {
        // TODO use config to handle float vs int
        getter = "getFloat";
      } else if (returnType.flags & tsInstance.TypeFlags.Boolean) {
        getter = "getBool";
      } else if (returnType.flags & tsInstance.TypeFlags.Object) {
        if (config.type === "FEATURE_TYPE_JSON") {
          getter = "getJSON";
        } else if (config.type === "FEATURE_TYPE_PROTO") {
          getter = "getProto";
        } else {
          throw new Error("Error");
        }
      }
      if (getter === undefined) {
        throw new Error(
          `Unsupported TypeScript type: ${returnType.flags} - ${program?.getTypeChecker().typeToString(returnType)}`,
        );
      }
      if (getter === "getProto") {
        const protoTypeParts = config.tree.default["@type"].split(".");
        const protoType = protoTypeParts[protoTypeParts.length - 1];
        const maybeProtoImport: ts.Node[] = [];
        if (!hasImportProto) {
          maybeProtoImport.push(
            factory.createImportDeclaration(
              undefined,
              factory.createImportClause(
                false,
                undefined,
                factory.createNamespaceImport(
                  factory.createIdentifier("lekko_pb"),
                ),
              ),
              factory.createStringLiteral(
                `./gen/${namespace}/config/v1beta1/${namespace}_pb.ts`,
              ),
              undefined,
            ),
          );
          hasImportProto = true;
        }
        return maybeProtoImport.concat([
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
                factory.createIdentifier(CTX_IDENTIFIER_NAME),
                undefined,
                undefined,
                undefined,
              ),
            ].concat(
              // For FE, require client as second parameter
              target !== "node"
                ? [
                    factory.createParameterDeclaration(
                      undefined,
                      undefined,
                      factory.createIdentifier("client"),
                      undefined,
                      undefined,
                      undefined,
                    ),
                  ]
                : [],
            ),
            node.type,
            prependParamVars(
              node,
              CTX_IDENTIFIER_NAME,
              wrapTryCatch(
                factory.createBlock(
                  [
                    factory.createVariableStatement(
                      undefined,
                      factory.createVariableDeclarationList(
                        [
                          factory.createVariableDeclaration(
                            CONFIG_IDENTIFIER_NAME,
                            undefined,
                            undefined,
                            factory.createNewExpression(
                              factory.createPropertyAccessExpression(
                                factory.createIdentifier("lekko_pb"),
                                factory.createIdentifier(protoType),
                              ),
                              undefined,
                              [],
                            ),
                          ),
                        ],
                        tsInstance.NodeFlags.Const,
                      ),
                    ),
                    factory.createExpressionStatement(
                      factory.createCallExpression(
                        factory.createPropertyAccessExpression(
                          factory.createIdentifier(CONFIG_IDENTIFIER_NAME),
                          factory.createIdentifier("fromBinary"),
                        ),
                        undefined,
                        [
                          factory.createPropertyAccessExpression(
                            factory.createCallExpression(
                              factory.createPropertyAccessExpression(
                                target !== "node"
                                  ? factory.createIdentifier("client")
                                  : factory.createParenthesizedExpression(
                                      factory.createAwaitExpression(
                                        factory.createCallExpression(
                                          factory.createPropertyAccessExpression(
                                            factory.createIdentifier("lekko"),
                                            factory.createIdentifier(
                                              "getClient",
                                            ),
                                          ),
                                          undefined,
                                          [],
                                        ),
                                      ),
                                    ),
                                factory.createIdentifier("getProto"),
                              ),
                              undefined,
                              [
                                factory.createStringLiteral(namespace),
                                factory.createStringLiteral(configName),
                                factory.createCallExpression(
                                  factory.createPropertyAccessExpression(
                                    factory.createPropertyAccessExpression(
                                      factory.createIdentifier("lekko"),
                                      factory.createIdentifier("ClientContext"),
                                    ),
                                    factory.createIdentifier("fromJSON"),
                                  ),
                                  undefined,
                                  [
                                    factory.createIdentifier(
                                      CTX_IDENTIFIER_NAME,
                                    ),
                                  ],
                                ),
                              ],
                            ),
                            factory.createIdentifier("value"),
                          ),
                        ],
                      ),
                    ),
                    factory.createReturnStatement(
                      factory.createIdentifier(CONFIG_IDENTIFIER_NAME),
                    ),
                  ],
                  true,
                ),
                node.body,
              ),
            ),
          ),
          // For use by FE SDKs to be able to identify configs
          factory.createExpressionStatement(
            factory.createBinaryExpression(
              factory.createPropertyAccessExpression(
                node.name,
                factory.createIdentifier("_namespaceName"),
              ),
              factory.createToken(tsInstance.SyntaxKind.EqualsToken),
              factory.createStringLiteral(namespace),
            ),
          ),
          factory.createExpressionStatement(
            factory.createBinaryExpression(
              factory.createPropertyAccessExpression(
                node.name,
                factory.createIdentifier("_configName"),
              ),
              factory.createToken(tsInstance.SyntaxKind.EqualsToken),
              factory.createStringLiteral(configName),
            ),
          ),
          factory.createExpressionStatement(
            factory.createBinaryExpression(
              factory.createPropertyAccessExpression(
                node.name,
                factory.createIdentifier("_evaluationType"),
              ),
              factory.createToken(tsInstance.SyntaxKind.EqualsToken),
              factory.createStringLiteral(config.type),
            ),
          ),
        ]);
      }
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
              undefined,
              undefined,
              undefined,
            ),
          ].concat(
            // For FE, require client as second parameter
            target !== "node"
              ? [
                  factory.createParameterDeclaration(
                    undefined,
                    undefined,
                    factory.createIdentifier("client"),
                    undefined,
                    undefined,
                    undefined,
                  ),
                ]
              : [],
          ),
          node.type,
          prependParamVars(
            node,
            CTX_IDENTIFIER_NAME,
            wrapTryCatch(
              factory.createBlock(
                [
                  target !== "node"
                    ? factory.createEmptyStatement()
                    : factory.createExpressionStatement(
                        factory.createAwaitExpression(
                          factory.createCallExpression(
                            // TODO -- this should be top level.. but ts module build shit is horrible
                            factory.createPropertyAccessExpression(
                              factory.createIdentifier("lekko"),
                              factory.createIdentifier("setupClient"),
                            ),
                            undefined,
                            [],
                          ),
                        ),
                      ),
                  factory.createReturnStatement(
                    factory.createCallExpression(
                      factory.createPropertyAccessExpression(
                        target !== "node"
                          ? factory.createIdentifier("client")
                          : factory.createParenthesizedExpression(
                              factory.createAwaitExpression(
                                factory.createCallExpression(
                                  factory.createPropertyAccessExpression(
                                    factory.createIdentifier("lekko"),
                                    factory.createIdentifier("getClient"),
                                  ),
                                  undefined,
                                  [],
                                ),
                              ),
                            ),
                        factory.createIdentifier(getter),
                      ),
                      undefined,
                      [
                        factory.createStringLiteral(namespace),
                        factory.createStringLiteral(configName),
                        factory.createCallExpression(
                          factory.createPropertyAccessExpression(
                            factory.createPropertyAccessExpression(
                              factory.createIdentifier("lekko"),
                              factory.createIdentifier("ClientContext"),
                            ),
                            factory.createIdentifier("fromJSON"),
                          ),
                          undefined,
                          [factory.createIdentifier(CTX_IDENTIFIER_NAME)],
                        ),
                      ],
                    ),
                  ),
                ],
                true,
              ),
              node.body,
            ),
          ),
        ),
        factory.createExpressionStatement(
          factory.createBinaryExpression(
            factory.createPropertyAccessExpression(
              node.name,
              factory.createIdentifier("_namespaceName"),
            ),
            factory.createToken(tsInstance.SyntaxKind.EqualsToken),
            factory.createStringLiteral(namespace),
          ),
        ),
        factory.createExpressionStatement(
          factory.createBinaryExpression(
            factory.createPropertyAccessExpression(
              node.name,
              factory.createIdentifier("_configName"),
            ),
            factory.createToken(tsInstance.SyntaxKind.EqualsToken),
            factory.createStringLiteral(configName),
          ),
        ),
        factory.createExpressionStatement(
          factory.createBinaryExpression(
            factory.createPropertyAccessExpression(
              node.name,
              factory.createIdentifier("_evaluationType"),
            ),
            factory.createToken(tsInstance.SyntaxKind.EqualsToken),
            factory.createStringLiteral(config.type),
          ),
        ),
      ];
    }

    // Prepend the given body with a variable assignment to make the function's parameters available
    // in the body. No-op if there was no parameter to start.
    // i.e. adds `const { env } = ctx` to start
    function prependParamVars(
      fd: ts.FunctionDeclaration,
      newParamName: string,
      body: ts.Block,
    ): ts.Block {
      // Get original first parameter to function
      const param = fd.parameters[0]?.getChildAt(0); // GetChild for discarding type info
      if (param === undefined) {
        return body;
      }
      return factory.createBlock([
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
        ...body.statements,
      ]);
    }

    // Use for handling static fallback
    function wrapTryCatch(tryBlock: ts.Block, catchBlock: ts.Block): ts.Block {
      return factory.createBlock([
        factory.createTryStatement(
          tryBlock,
          factory.createCatchClause(
            factory.createVariableDeclaration(
              factory.createIdentifier("e"),
              undefined,
              undefined,
              undefined,
            ),
            catchBlock,
          ),
          undefined,
        ),
      ]);
    }

    function addLekkoImports(sourceFile: ts.SourceFile): ts.SourceFile {
      return factory.updateSourceFile(sourceFile, [
        factory.createImportDeclaration(
          undefined,
          factory.createImportClause(
            false,
            undefined,
            factory.createNamespaceImport(factory.createIdentifier("lekko")),
          ),
          factory.createStringLiteral(
            target !== "node" ? "@lekko/js-sdk" : "@lekko/node-server-sdk",
          ),
          undefined,
        ),
        ...sourceFile.statements,
      ]);
    }

    return (sourceFile: ts.SourceFile): ts.SourceFile => {
      const protoFileBuilder: ProtoFileBuilder = { messages: {}, enums: {} };
      const configs: LekkoConfigJSON[] = [];
      const namespace = path.basename(
        sourceFile.path,
        path.extname(sourceFile.path),
      );

      function visit(node: ts.Node): ts.Node | ts.Node[] | undefined {
        if (tsInstance.isSourceFile(node)) {
          const match = node.fileName.match(LEKKO_FILENAME_REGEX);
          if (match) {
            let transformed = addLekkoImports(node);

            transformed = tsInstance.visitEachChild(
              transformed,
              visit,
              context,
            );

            try {
              // The following are per-file operations
              checkCLIDeps();
              // TODO this needs to be a no-op if the tools aren't there
              genProtoFile(sourceFile, repoPath, protoFileBuilder);
              configs.forEach((config) =>
                genStarlark(repoPath, namespace, config),
              );
            } catch (e) {
              if (pluginConfig?.verbose === true && e instanceof Error) {
                console.error(e.message);
              } else {
                console.log(
                  "[@lekko/ts-transformer] CLI tools missing, skipping proto and starlark generation.",
                );
              }
            }
            return transformed;
          } else {
            return node;
          }
        } else if (tsInstance.isFunctionDeclaration(node)) {
          const { checkedNode, configName, returnType } =
            checkConfigFunctionDeclaration(node);
          // Apply changes to config repo
          const configJSON = functionToConfigJSON(
            checkedNode,
            checker,
            namespace,
            configName,
            returnType,
          );
          configs.push(configJSON);
          // Transform local (static) to SDK client calls
          return transformLocalToRemote(
            checkedNode,
            namespace,
            configName,
            returnType,
            configJSON,
          );
        } else if (tsInstance.isInterfaceDeclaration(node)) {
          // Build proto definitions from interfaces
          interfaceToProto(node, checker, protoFileBuilder);
          // Remove declarations - to be replaced with proto bindings

          return undefined;
        }
        return node;
      }
      const visited = tsInstance.visitNode(sourceFile, visit) as ts.SourceFile;

      return visited;
    };
  };
}
