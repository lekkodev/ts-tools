"use client";
import { GetRepositoryContentsResponse } from "./gen/lekko/backend/v1beta1/distribution_service_pb";
import { useState, createContext, useContext, type PropsWithChildren } from "react";
import { evaluate } from "./evaluation/eval";
import {
  BoolValue,
  DoubleValue,
  Int64Value,
  StringValue,
} from "@bufbuild/protobuf";
import { ClientContext } from "./context";
var base64 = require("base-64");

export function useLekkoConfig(
  configFn: Function,
  context: any,
) {
  const client = useContext(LekkoClientContext);
  return configFn(context, client);
}

class Client {
  configs: Map<any, any>;
  constructor(configs: GetRepositoryContentsResponse) {
    this.configs = new Map();
    for (const namespace of configs.namespaces) {
      const nsMap = new Map();
      this.configs.set(namespace.name, nsMap);
      for (const feature of namespace.features) {
        nsMap.set(feature.name, feature.feature);
      }
    }
  }
  getBool(namespace: string, key: string, ctx: ClientContext): boolean {
    const wrapper = new BoolValue();
    const wrapped = evaluate(
      this.configs.get(namespace).get(key),
      namespace,
      ctx,
    ).value;
    if (wrapped.unpackTo(wrapper) === undefined) {
      throw new Error("type mismatch");
    }
    return wrapper.value;
  }
  getInt(namespace: string, key: string, ctx: ClientContext): number {
    const wrapper = new Int64Value();
    const wrapped = evaluate(
      this.configs.get(namespace).get(key),
      namespace,
      ctx,
    ).value;
    if (wrapped.unpackTo(wrapper) === undefined) {
      throw new Error("type mismatch");
    }
    return Number(wrapper.value);
  }
  getFloat(namespace: string, key: string, ctx: ClientContext): number {
    const wrapper = new DoubleValue();
    const wrapped = evaluate(
      this.configs.get(namespace).get(key),
      namespace,
      ctx,
    ).value;
    if (wrapped.unpackTo(wrapper) === undefined) {
      throw new Error("type mismatch");
    }
    return wrapper.value;
  }
  getString(namespace: string, key: string, ctx: ClientContext): string {
    const wrapper = new StringValue();
    const wrapped = evaluate(
      this.configs.get(namespace).get(key),
      namespace,
      ctx,
    ).value;
    if (wrapped.unpackTo(wrapper) === undefined) {
      throw new Error("type mismatch");
    }
    return wrapper.value;
  }
  getJSON(namespace: string, key: string, ctx: ClientContext) {
    return JSON.parse(
      "" // TODO evaluate(this.configs.get(namespace).get(key), namespace, ctx).value,
    );
  }

  getProto(namespace: string, key: string, ctx: ClientContext) {
    return evaluate(this.configs.get(namespace).get(key), namespace, ctx).value;
  }
}
// @ts-ignore
export const LekkoClientContext = createContext<Client|undefined>();

interface LekkoClientProviderType extends PropsWithChildren {
  repo: string
}

export function LekkoClientProvider({ repo, children } : LekkoClientProviderType) {
  const [repoContents, _setRepoContents] = useState(() => {
    if (repo) {
      return new Client(
        GetRepositoryContentsResponse.fromBinary(
          new Uint8Array(base64.decode(repo).split(",")),
        ),
      );
      
    }
    return undefined;
  });

  return (
    <LekkoClientContext.Provider value={repoContents}>
      {children}
    </LekkoClientContext.Provider>
  );
}

