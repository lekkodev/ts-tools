import { type PluginConfig } from "ts-patch";

// TODO: There's probably a way to organize types using very clever discriminated
// unions that might cut down on a lot of conditionals in the consuming code

export interface LekkoTransformerOptions extends PluginConfig {
  repoPath?: string;
  noStatic?: boolean;
}

export type LekkoLogicalOperator =
  | "LOGICAL_OPERATOR_AND"
  | "LOGICAL_OPERATOR_OR";

// TODO: Other comparators
export type LekkoComparisonOperator = "COMPARISON_OPERATOR_EQUALS";

export type LekkoConfigType =
  | "FEATURE_TYPE_BOOL"
  | "FEATURE_TYPE_STRING"
  | "FEATURE_TYPE_INT"
  | "FEATURE_TYPE_FLOAT"
  | "FEATURE_TYPE_JSON"
  | "FEATURE_TYPE_PROTO";

export type LekkoConfigTypeURL<T extends LekkoConfigType> =
  T extends "FEATURE_TYPE_BOOL"
    ? "type.googleapis.com/google.protobuf.BoolValue"
    : T extends "FEATURE_TYPE_BOOL"
      ? "type.googleapis.com/google.protobuf.StringValue"
      : T extends "FEATURE_TYPE_INT"
        ? "type.googleapis.com/google.protobuf.IntValue"
        : T extends "FEATURE_TYPE_FLOAT"
          ? "type.googleapis.com/google.protobuf.FloatValue"
          : T extends "FEATURE_TYPE_PROTO"
            ? string
            : never; // JSON not currently supported

export interface LekkoConfigJSON<T extends LekkoConfigType = LekkoConfigType> {
  key: string;
  description: string;
  tree: LekkoConfigJSONTree<T>;
  type: T;
}

export interface LekkoConfigJSONTree<T extends LekkoConfigType> {
  default: LekkoConfigJSONValue<T>;
  constraints?: {
    ruleAstNew: LekkoConfigJSONRule;
    value: LekkoConfigJSONValue<T>;
  }[];
}

export type LekkoConfigJSONValue<T extends LekkoConfigType = LekkoConfigType> =
  T extends "FEATURE_TYPE_BOOL"
    ? { "@type": LekkoConfigTypeURL<T>; value: boolean }
    : T extends "FEATURE_TYPE_STRING"
      ? { "@type": LekkoConfigTypeURL<T>; value: string }
      : T extends "FEATURE_TYPE_INT" | "FEATURE_TYPE_FLOAT"
        ? { "@type": LekkoConfigTypeURL<T>; value: number }
        : T extends "FEATURE_TYPE_PROTO"
          ? { "@type": string; [key: string]: JSONValue }
          : never;

export type LekkoConfigJSONRule =
  | {
      atom: LekkoConfigJSONAtom;
    }
  | {
      logicalExpression: LekkoConfigJSONLogicalExpression;
    };

export interface LekkoConfigJSONAtom {
  contextKey: string;
  comparisonValue?: string | number | boolean;
  comparisonOperator: LekkoComparisonOperator;
}

export interface LekkoConfigJSONLogicalExpression {
  rules: LekkoConfigJSONRule[];
  logicalOperator: LekkoLogicalOperator;
}

// null is omitted here because config model doesn't store nulls
export type JSONValue = number | string | boolean | JSONObject | JSONValue[];

export type JSONObject = {
  [key: string]: JSONValue;
};
