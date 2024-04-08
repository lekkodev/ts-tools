import type ts from "typescript";

export class LekkoFunctionError extends Error {
  constructor(node: ts.FunctionDeclaration, message: string) {
    const { line, character } = node
      .getSourceFile()
      .getLineAndCharacterOfPosition(node.pos);
    const funcName =
      node.name?.getFullText().trim() ??
      `function at ln ${line}, col ${character}`;
    super(`${funcName}: ${message}`);
    this.name = "LekkoFunctionError";
  }
}
