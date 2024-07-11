"use client";

import { type PropsWithChildren, createContext, useContext, useEffect, useMemo } from "react";
import { type SyncClient, initAPIClientFromContents, logError, logInfo } from "@lekko/js-sdk";
import { type EncodedLekkoConfigs } from "./types";

export type LekkoContext = Record<string, boolean | string | number>;

export type LekkoConfigFn<T, C extends LekkoContext> = (context: C, client?: SyncClient) => T;

/**
 * A hook for evaluating Lekko config functions.
 *
 * @param configFn A function that takes a context and returns the evaluated value. Should be transformed at build time to use dynamic, up-to-date data with static fallback behavior.
 * @param context The context that will be passed to the config function. Type checks will guarantee that the context passed satisfies the context required by the config function.
 * @returns The evaluation value based on the config function
 */
export function useLekkoConfig<T, C extends LekkoContext>(configFn: LekkoConfigFn<T, C>, context: C): T {
  const client = useContext(LekkoClientContext);
  if (client === null) {
    return configFn(context);
  }
  return configFn(context, client);
}

const LekkoClientContext = createContext<SyncClient | null>(null);

interface LekkoClientProviderProps extends PropsWithChildren {
  /**
   * Encoded binary representation of a remote config repository.
   * See `getEncodedLekkoConfig` for a function to fetch this information.
   */
  configs?: EncodedLekkoConfigs | null;
  fetchError?: string;
}

/**
 * This is a client component that can be used with App Router or Pages Router.
 *
 * It should be placed high in the component tree. This provider allows `useLekkoConfig`
 * calls in the sub-component tree to use dynamic values from Lekko.
 *
 * The value for the `configs` prop can be fetched using `getEncodedLekkoConfigs`.
 */
export function LekkoClientProvider({ configs, fetchError, children }: LekkoClientProviderProps) {
  const apiKey = process.env.NEXT_PUBLIC_LEKKO_API_KEY;
  const repositoryOwner = process.env.NEXT_PUBLIC_LEKKO_REPOSITORY_OWNER;
  const repositoryName = process.env.NEXT_PUBLIC_LEKKO_REPOSITORY_NAME;

  const client = useMemo(() => {
    if (configs == null) {
      logInfo(`[lekko] ${fetchError ?? ""} Remote lekkos are not available, in-code fallback will be used.`);
      return null;
    }
    try {
      return initAPIClientFromContents(configs, {
        apiKey: apiKey ?? "",
        repositoryOwner: repositoryOwner ?? "",
        repositoryName: repositoryName ?? "",
      });
    } catch (e) {
      logError(
        `[lekko] Failed to initialize Lekko client from hydrated data, defaulting to in-code fallback: ${(e as Error).message}`,
      );
      return null;
    }
  }, [configs]);

  // Call initialize in useEffect to prevent running POST requests during SSR
  useEffect(() => {
    if (apiKey !== undefined && repositoryOwner !== undefined && repositoryName !== undefined && client !== null) {
      // Client is actually initialized above, this just registers and sets up the event tracker
      client.initialize(false).catch(() => {
        logError("[lekko] Failed to register Lekko SDK client, evaluations will not be tracked");
      });
    }
  }, [client]);

  return <LekkoClientContext.Provider value={client}>{children}</LekkoClientContext.Provider>;
}
