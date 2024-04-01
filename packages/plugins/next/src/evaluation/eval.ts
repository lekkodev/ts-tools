import {
  type Constraint,
  type Feature,
  type Any as LekkoAny,
} from "../gen/lekko/feature/v1beta1/feature_pb"
import { Any } from "@bufbuild/protobuf"
import evaluateRule from "./rule"
import { ClientContext } from "../context"

export interface EvaluationResult {
  value: Any
  // Stores the path of the tree node that returned the final value
  // after successful evaluation.
  path: number[]
}

// Evaluates the config with the given context. Evaluation follows a tree-traversal algorithm,
// where the config is represented as a tree. The root of the tree contains a default value, and
// each override is a child node of the root. Overrides can also have overrides, which is what
// makes this an n-level tree traversal algorithm.
export function evaluate(
  config: Feature,
  namespace: string,
  context?: ClientContext,
): EvaluationResult {
  if (config.tree === undefined) {
    throw new Error("config tree is empty")
  }
  for (let i = 0; i < config.tree.constraints.length; i++) {
    const childResult = traverse(
      config.tree.constraints[i],
      namespace,
      config.key,
      context,
    )
    if (childResult.passes) {
      if (childResult.value !== undefined) {
        return {
          value: childResult.value,
          path: [i, ...childResult.path],
        }
      }
      break
    }
  }
  return {
    value: getValue(config.tree.default, config.tree.defaultNew),
    path: [],
  }
}

interface traverseResult {
  value?: Any
  passes: boolean
  path: number[]
}

function traverse(
  override: Constraint | undefined,
  namespace: string,
  configName: string,
  context?: ClientContext,
): traverseResult {
  if (override === undefined) {
    return { passes: false, path: [] }
  }
  const passes = evaluateRule(
    override.ruleAstNew,
    namespace,
    configName,
    context,
  )
  if (!passes) {
    // If the rule fails, we avoid further traversal
    return { passes, path: [] }
  }

  // rule passed
  for (let i = 0; i < override.constraints.length; i++) {
    const childResult = traverse(
      override.constraints[i],
      namespace,
      configName,
      context,
    )
    if (childResult.passes) {
      // We may stop iterating. But first, remember the traversed value if it exists.
      if (childResult.value !== undefined) {
        return {
          value: childResult.value,
          passes: true,
          path: [i, ...childResult.path],
        }
      }
      break
    }
    // Child evaluation did not pass, continue iterating
  }
  return {
    value: getValue(override.value, override.valueNew),
    passes: true,
    path: [],
  }
}

function getValue(val: Any | undefined, valNew: LekkoAny | undefined): Any {
  if (valNew !== undefined) {
    return new Any({
      typeUrl: valNew.typeUrl,
      value: valNew.value,
    })
  }
  if (val !== undefined) {
    return val
  }
  throw new Error("config value not found")
}
