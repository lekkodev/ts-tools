import assert from "assert";
import fs from "fs";
import os from "os";
import path from "path";
import { type TransformerExtras } from "ts-patch";
import ts from "typescript";
import { type LekkoConfigJSON, type LekkoTransformerOptions } from "./types";
import { LEKKO_FILENAME_REGEX } from "./helpers";

// Transformer Factory function
export default function (
  program?: ts.Program,
  pluginConfig?: LekkoTransformerOptions,
  _transformerExtras?: TransformerExtras,
) {
  let repo_root = path.join(
    os.homedir(),
    "Library/Application Support/Lekko/Config Repositories/default/",
  );
  if (pluginConfig?.repoPath !== undefined) {
    repo_root = pluginConfig.repoPath;
  }

  return (context: ts.TransformationContext) => {
    const { factory } = context;
    let namespace: string | undefined;

    function injectMagic(node: ts.Statement): ts.Statement | ts.Statement[] {
      if (ts.isFunctionDeclaration(node)) {
        const sig = program?.getTypeChecker().getSignatureFromDeclaration(node);
        assert(sig);
        assert(node.name);
        assert(node.body);
        assert(namespace);
        const functionName = node.name.getFullText().trim();
        const configName = functionName
          .replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
          .replace(/get-/, "");
        let getter: string | undefined = undefined;

        const type = program
          ?.getTypeChecker()
          .getPromisedTypeOfPromise(sig.getReturnType());
        assert(type);
        // TODO: Allow no parameters (i.e. contextless)
        const paramsAsBareObj = sig.parameters[0]?.valueDeclaration
          ?.getChildren()[0]
          ?.getFullText();

        // We work with parsing the JSON representations of config protos for now
        // It's probably slower but less dependencies to worry about and still "typed"
        const storedConfig = JSON.parse(
          fs
            .readFileSync(
              path.join(
                repo_root,
                namespace,
                "/gen/json/",
                `${configName}.json`,
              ),
            )
            .toString(),
        ) as LekkoConfigJSON;

        if (type.flags & ts.TypeFlags.String) {
          getter = "getString";
        } else if (type.flags & ts.TypeFlags.Number) {
          // TODO used storedConfig to handle float vs int
          getter = "getFloat";
        } else if (type.flags & ts.TypeFlags.Boolean) {
          getter = "getBool";
        } else if (type.flags & ts.TypeFlags.Object) {
          if (storedConfig.type === "FEATURE_TYPE_JSON") {
            getter = "getJSON";
          } else if (storedConfig.type === "FEATURE_TYPE_PROTO") {
            getter = "getProto";
          } else {
            throw new Error("Error");
          }
        }
        if (getter === undefined) {
          throw new Error(
            `Unsupported TypeScript type: ${type.flags} - ${program?.getTypeChecker().typeToString(type)}`,
          );
        }
        if (getter === "getProto") {
          const protoTypeParts = storedConfig.tree.default["@type"].split(".");
          const protoType = protoTypeParts[protoTypeParts.length - 1];
          // For JS SDK the get calls need to be awaited
          const wrapAwait = (expr: ts.Expression) =>
            pluginConfig?.noStatic ? factory.createAwaitExpression(expr) : expr;
          return [
            factory.createImportDeclaration(
              undefined,
              factory.createImportClause(
                false,
                undefined,
                ts.factory.createNamespaceImport(
                  ts.factory.createIdentifier("lekko_pb"),
                ),
              ),
              factory.createStringLiteral(
                `./gen/${namespace}/config/v1beta1/${namespace}_pb.js`,
              ),
              undefined,
            ),
            ts.factory.updateFunctionDeclaration(
              node,
              node.modifiers,
              node.asteriskToken,
              node.name,
              node.typeParameters,
              pluginConfig?.noStatic
                ? [
                    ...node.parameters,
                    factory.createParameterDeclaration(
                      undefined,
                      undefined,
                      factory.createIdentifier("client"),
                      undefined,
                      undefined,
                      undefined,
                    ),
                  ]
                : node.parameters,
              node.type,
              factory.createBlock(
                [
                  factory.createTryStatement(
                    factory.createBlock(
                      [
                        factory.createVariableStatement(
                          undefined,
                          factory.createVariableDeclarationList(
                            [
                              factory.createVariableDeclaration(
                                "config",
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
                            ts.NodeFlags.Const,
                          ),
                        ),
                        factory.createExpressionStatement(
                          factory.createCallExpression(
                            factory.createPropertyAccessExpression(
                              factory.createIdentifier("config"),
                              factory.createIdentifier("fromBinary"),
                            ),
                            undefined,
                            [
                              factory.createPropertyAccessExpression(
                                wrapAwait(
                                  factory.createCallExpression(
                                    factory.createPropertyAccessExpression(
                                      pluginConfig?.noStatic
                                        ? factory.createIdentifier("client")
                                        : factory.createParenthesizedExpression(
                                            factory.createAwaitExpression(
                                              factory.createCallExpression(
                                                factory.createPropertyAccessExpression(
                                                  factory.createIdentifier(
                                                    "lekko",
                                                  ),
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
                                            factory.createIdentifier(
                                              "ClientContext",
                                            ),
                                          ),
                                          factory.createIdentifier("fromJSON"),
                                        ),
                                        undefined,
                                        paramsAsBareObj
                                          ? [
                                              factory.createIdentifier(
                                                paramsAsBareObj,
                                              ),
                                            ]
                                          : [],
                                      ),
                                    ],
                                  ),
                                ),
                                factory.createIdentifier("value"),
                              ),
                            ],
                          ),
                        ),
                        factory.createReturnStatement(
                          factory.createIdentifier("config"),
                        ),
                      ],
                      true,
                    ),
                    factory.createCatchClause(
                      factory.createVariableDeclaration(
                        factory.createIdentifier("e"),
                        undefined,
                        undefined,
                        undefined,
                      ),
                      pluginConfig?.noStatic
                        ? factory.createBlock(
                            [
                              factory.createThrowStatement(
                                factory.createIdentifier("e"),
                              ),
                            ],
                            true,
                          )
                        : node.body,
                    ),
                    undefined,
                  ),
                ],
                true,
              ),
            ),
            factory.createExpressionStatement(
              factory.createBinaryExpression(
                factory.createPropertyAccessExpression(
                  node.name,
                  factory.createIdentifier("_namespaceName"),
                ),
                factory.createToken(ts.SyntaxKind.EqualsToken),
                factory.createStringLiteral(namespace),
              ),
            ),
            factory.createExpressionStatement(
              factory.createBinaryExpression(
                factory.createPropertyAccessExpression(
                  node.name,
                  factory.createIdentifier("_configName"),
                ),
                factory.createToken(ts.SyntaxKind.EqualsToken),
                factory.createStringLiteral(configName),
              ),
            ),
            factory.createExpressionStatement(
              factory.createBinaryExpression(
                factory.createPropertyAccessExpression(
                  node.name,
                  factory.createIdentifier("_evaluationType"),
                ),
                factory.createToken(ts.SyntaxKind.EqualsToken),
                factory.createStringLiteral(storedConfig.type),
              ),
            ),
          ];
        }
        return [
          ts.factory.updateFunctionDeclaration(
            node,
            node.modifiers,
            node.asteriskToken,
            node.name,
            node.typeParameters,
            pluginConfig?.noStatic
              ? [
                  ...node.parameters,
                  factory.createParameterDeclaration(
                    undefined,
                    undefined,
                    factory.createIdentifier("client"),
                    undefined,
                    undefined,
                    undefined,
                  ),
                ]
              : node.parameters,
            node.type,
            factory.createBlock(
              [
                factory.createTryStatement(
                  factory.createBlock(
                    [
                      pluginConfig?.noStatic
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
                        factory.createAwaitExpression(
                          factory.createCallExpression(
                            factory.createPropertyAccessExpression(
                              pluginConfig?.noStatic
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
                                paramsAsBareObj
                                  ? [factory.createIdentifier(paramsAsBareObj)]
                                  : [],
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],
                    true,
                  ),
                  factory.createCatchClause(
                    factory.createVariableDeclaration(
                      factory.createIdentifier("e"),
                      undefined,
                      undefined,
                      undefined,
                    ),
                    pluginConfig?.noStatic
                      ? factory.createBlock(
                          [
                            factory.createThrowStatement(
                              factory.createIdentifier("e"),
                            ),
                          ],
                          true,
                        )
                      : node.body,
                  ),
                  undefined,
                ),
              ],
              true,
            ),
          ),
          factory.createExpressionStatement(
            factory.createBinaryExpression(
              factory.createPropertyAccessExpression(
                node.name,
                factory.createIdentifier("_namespaceName"),
              ),
              factory.createToken(ts.SyntaxKind.EqualsToken),
              factory.createStringLiteral(namespace),
            ),
          ),
          factory.createExpressionStatement(
            factory.createBinaryExpression(
              factory.createPropertyAccessExpression(
                node.name,
                factory.createIdentifier("_configName"),
              ),
              factory.createToken(ts.SyntaxKind.EqualsToken),
              factory.createStringLiteral(configName),
            ),
          ),
          factory.createExpressionStatement(
            factory.createBinaryExpression(
              factory.createPropertyAccessExpression(
                node.name,
                factory.createIdentifier("_evaluationType"),
              ),
              factory.createToken(ts.SyntaxKind.EqualsToken),
              factory.createStringLiteral(storedConfig.type),
            ),
          ),
        ];
      }
      return node;
    }

    const visitor: ts.Visitor = (node: ts.Node) => {
      if (ts.isSourceFile(node)) {
        const match = node.fileName.match(LEKKO_FILENAME_REGEX);
        if (match) {
          namespace = match[1];
          const importDeclaration = ts.factory.createImportDeclaration(
            undefined,
            ts.factory.createImportClause(
              false,
              undefined,
              ts.factory.createNamespaceImport(
                ts.factory.createIdentifier("lekko"),
              ),
            ),
            ts.factory.createStringLiteral(
              pluginConfig?.noStatic
                ? "@lekko/js-sdk"
                : "@lekko/node-server-sdk",
            ),
            undefined,
          );

          const transformed = ts.visitNodes<
            ts.Statement,
            ts.NodeArray<ts.Statement>,
            ts.Statement
          >(node.statements, injectMagic, (node): node is ts.Statement =>
            ts.isStatement(node),
          );

          return ts.factory.updateSourceFile(node, [
            importDeclaration,
            ...transformed,
          ]);
        }
      }
      return node;
    };

    return (file: ts.SourceFile) => ts.visitNode(file, visitor);
  };
}
