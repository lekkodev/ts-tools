import type ts from "typescript";

export class LekkoParseError extends Error {
  constructor(message: string, node: ts.Node) {
    const { line, character } = node.getSourceFile().getLineAndCharacterOfPosition(node.pos);
    const filename = node.getSourceFile().fileName;
    super(`${filename}:${line + 1}:${character + 1} - ${message}`);
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
