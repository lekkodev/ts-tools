"use client";

import {
  type PropsWithChildren,
  createContext,
  useContext,
  useEffect,
  useMemo,
} from "react";
import { type SyncClient, initAPIClientFromContents } from "@lekko/js-sdk";

export type LekkoContext = Record<string, boolean | string | number>;

export type LekkoConfigFn<T, C extends LekkoContext> = (
  context: C,
  client?: SyncClient,
) => T;

/**
 * A hook for evaluation Lekko config functions.
 *
 * @param configFn A function that takes a context and returns the evaluated value. Should be transformed at build time to use dynamic, up-to-date data with static fallback behavior.
 * @param context The context that will be passed to the config function. Type checks will guarantee that the context passed satisfies the context required by the config function.
 * @returns The evaluation value based on the config function
 */
export function useLekkoConfig<T, C extends LekkoContext>(
  configFn: LekkoConfigFn<T, C>,
  context: C,
): T {
  const client = useContext(LekkoClientContext);
  if (client === null) {
    return configFn(context);
  }
  return configFn(context, client);
}

const LekkoClientContext = createContext<SyncClient | null>(null);

interface LekkoClientProviderProps extends PropsWithChildren {
  /**
   * Base-64 encoded binary representation of repo contents
   */
  encodedRepoContents?: string;
}

/**
 * @internal Automatically created by LekkoNextProvider
 */
export function LekkoClientProvider({
  encodedRepoContents,
  children,
}: LekkoClientProviderProps) {
  const apiKey = process.env.NEXT_PUBLIC_LEKKO_API_KEY;
  const repositoryOwner = process.env.NEXT_PUBLIC_LEKKO_REPOSITORY_OWNER;
  const repositoryName = process.env.NEXT_PUBLIC_LEKKO_REPOSITORY_NAME;

  const client = useMemo(() => {
    if (encodedRepoContents === undefined) {
      return null;
    }
    try {
      return initAPIClientFromContents(encodedRepoContents, {
        apiKey: apiKey ?? "",
        repositoryOwner: repositoryOwner ?? "",
        repositoryName: repositoryName ?? "",
      });
    } catch (e) {
      console.warn(
        `Failed to initialize Lekko client from hydrated data, defaulting to static fallback: ${(e as Error).message}`,
      );
      return null;
    }
  }, [encodedRepoContents]);

  // Call in useEffect to prevent running during SSR
  useEffect(() => {
    if (
      apiKey !== undefined &&
      repositoryOwner !== undefined &&
      repositoryName !== undefined &&
      client !== null
    ) {
      client.initialize(false).catch(() => {
        console.warn(
          "Failed to register Lekko SDK client, evaluations will not be tracked",
        );
      });
    }
  }, [client]);

  return (
    <LekkoClientContext.Provider value={client}>
      {children}
    </LekkoClientContext.Provider>
  );
}
