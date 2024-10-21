import type ts from "typescript";

export class LekkoParseError extends Error {
  constructor(message: string, node: ts.Node) {
    const { line: startLine, character: startCol } = node.getSourceFile().getLineAndCharacterOfPosition(node.pos);
    const { line: endLine, character: endCol } = node.getSourceFile().getLineAndCharacterOfPosition(node.end);
    const filename = node.getSourceFile().fileName;
    super(`${filename}:${startLine + 1}:${startCol + 1}:${endLine + 1}:${endCol + 1} - ${message}`);
    this.name = "LekkoParseError";
  }
}

export class LekkoConfError extends Error {
  constructor(message: string) {
    super(`Lekko configuration file error: ${message}`);
    this.name = "LekkoConfError";
  }
}

export class LekkoGenError extends Error {
  constructor(message: string) {
    super(`Lekko code generation error: ${message}`);
    this.name = "LekkoGenError";
  }
}
