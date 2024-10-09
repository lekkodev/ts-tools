import { cache, type PropsWithChildren } from "react";
import { GetRepositoryContentsResponse } from "@lekko/js-sdk/internal";
import { getOptionalClient, logError, logInfo } from "@lekko/js-sdk";
import { createEnvelopeReadableStream } from "@connectrpc/connect/protocol";
import { trailerFlag, trailerParse } from "@connectrpc/connect/protocol-grpc-web";
import { fromUint8Array } from "js-base64";
import { LekkoClientProvider } from "./client";
import { type EncodedLekkoConfigs } from "./types";
import {
  type GetStaticProps,
  type GetServerSideProps,
  type GetServerSidePropsContext,
  type GetStaticPropsContext,
} from "next";

async function getRepositoryContents(
  apiKey: string,
  repositoryOwner: string,
  repositoryName: string,
  revalidate: number | false,
) {
  const response = await fetch(
    "https://relay.lekko-cdn.com/" + btoa(`${repositoryOwner}/${repositoryName}/${apiKey}`),
    { next: { revalidate } },
  );
  if (!response.ok || response.body === null) {
    throw new Error("Invalid repository contents response");
  }
  let trailer: Headers | undefined;
  let message: GetRepositoryContentsResponse | undefined;
  const reader = createEnvelopeReadableStream(response.body).getReader();
  for (;;) {
    const res = await reader.read();
    if (res.done) {
      break;
    }
    const { flags, data } = res.value;
    if (flags === trailerFlag) {
      if (trailer !== undefined) {
        throw new Error("Extra trailer in repository contents response");
      }
      // Unary responses require exactly one response message, but in
      // case of an error, it is perfectly valid to have a response body
      // that only contains error trailers.
      trailer = trailerParse(data);
      continue;
    }
    if (message !== undefined) {
      throw new Error("Extra message in repository contents response");
    }
    message = GetRepositoryContentsResponse.fromBinary(data);
  }
  if (message === undefined) {
    throw new Error("Missing repository contents");
  }
  logInfo(`[lekko] Connected to ${repositoryOwner}/${repositoryName} using API key "${apiKey?.slice(0, 12)}..."`);
  return message;
}

/**
 * Fetch Lekko configs for the project. The result should be passed to `LekkoClientProvider`
 * to hydrate client components and make remote configs usable.
 *
 * In Pages Router, this can be called in `getServerSideProps` or `getStaticProps`.
 * If using `getStaticProps`, it's recommended to try to use [ISR](https://nextjs.org/docs/pages/building-your-application/data-fetching/incremental-static-regeneration)
 * to ensure the project can use up-to-date configs without having to wait for rebuilds.
 *
 * In App Router, this can be called in any server component, or `LekkoNextProvider`
 * can be used instead, which uses this function under the hood.
 *
 * Automatically reads relevant Lekko environment variables.
 */
export async function getEncodedLekkoConfigs({
  revalidate,
  apiKey,
  repositoryOwner,
  repositoryName,
}: {
  /**
   * Maximum time, in seconds, of how long Lekko configs fetched from remote
   * should be cached. This is passed as is to the underlying `fetch()` call
   * which is patched by Next.js for control over the cacheability of this
   * call (and as a consequence, the static/dynamic rendering behavior of the
   * page).
   *
   * See relevant Next.js [docs](https://nextjs.org/docs/app/building-your-application/caching#time-based-revalidation)
   *
   * Defaults to 15 seconds.
   */
  revalidate?: number | false;
  apiKey?: string;
  repositoryOwner?: string;
  repositoryName?: string;
} = {}): Promise<{ configs?: EncodedLekkoConfigs; fetchError?: string }> {
  apiKey ??= process.env.NEXT_PUBLIC_LEKKO_API_KEY;
  repositoryOwner ??= process.env.NEXT_PUBLIC_LEKKO_REPOSITORY_OWNER;
  repositoryName ??= process.env.NEXT_PUBLIC_LEKKO_REPOSITORY_NAME;
  if (apiKey === undefined || repositoryOwner === undefined || repositoryName === undefined) {
    return { fetchError: "Environment variables are not set." };
  }
  try {
    const contents = await getRepositoryContents(apiKey, repositoryOwner, repositoryName, revalidate ?? 15);
    return { configs: fromUint8Array(contents.toBinary()) };
  } catch (e) {
    return { fetchError: `Failed to fetch remote lekkos: ${(e as Error).message}.` };
  }
}

export interface LekkoNextProviderProps extends PropsWithChildren {
  /**
   * Maximum time, in seconds, of how long Lekko configs fetched from remote
   * should be cached. Disabling revalidation (by passing false) means
   * that values will stay the same until a rebuild. Setting it to 0 will
   * force dynamic rendering of the sub-component tree.
   *
   * See relevant Next.js [docs](https://nextjs.org/docs/app/building-your-application/caching#time-based-revalidation)
   *
   * Defaults to 15 seconds.
   */
  revalidate?: number | false;
  useGlobalClient?: boolean;
}

// wrap in react.cache to make it play nicer with Next.js caching
const getContentsFromGlobalClient = cache(() => getOptionalClient()?.contentsResponse);

/**
 * This provider is only compatible with the App Router. For Pages Router, see LekkoClientProvider.
 *
 * This server-side provider should be placed high in the component tree (e.g. root layout).
 * Client components under it in the component tree will be able to use `useLekkoConfig`
 * to evaluate configs.
 */
export async function LekkoNextProvider({ revalidate, children, useGlobalClient }: LekkoNextProviderProps) {
  let configs: string | undefined;
  let fetchError: string | undefined;

  if (useGlobalClient) {
    const contents = getContentsFromGlobalClient();
    if (contents !== undefined) {
      logInfo(`[lekko] Using contents from global client: ${contents.commitSha}`);
      configs = fromUint8Array(contents.toBinary());
    } else {
      logError(`[lekko] Global client is not initialized`);
      fetchError = "Lekko client is not initialized.";
    }
  } else {
    const encodedContents = await getEncodedLekkoConfigs({ revalidate });
    configs = encodedContents.configs;
    fetchError = encodedContents.fetchError;
  }

  return (
    <LekkoClientProvider configs={configs} fetchError={fetchError}>
      {children}
    </LekkoClientProvider>
  );
}

/**
 * Convenience wrapper for `getServerSideProps` that injects a page prop, `lekkoConfigs` which
 * should be passed to `LekkoClientProvider`.
 *
 * Alternatively, you can manually use `getEncodedLekkoConfigs` in your `getServerSideProps`.
 */
export function withLekkoServerSideProps(getServerSidePropsFn?: GetServerSideProps): GetServerSideProps {
  return async (context: GetServerSidePropsContext) => {
    const lekkoConfigs = await getEncodedLekkoConfigs();

    const origRet = await getServerSidePropsFn?.(context);
    const origProps = await (origRet !== undefined && "props" in origRet ? origRet.props : undefined);

    return {
      ...origRet,
      props: {
        ...origProps,
        ...lekkoConfigs,
      },
    };
  };
}

/**
 * Convenience wrapper for `getStaticProps` that injects a page prop, `lekkoConfigs` which
 * should be passed to `LekkoClientProvider`.
 *
 * If possible, it's recommended to use [ISR](https://nextjs.org/docs/pages/building-your-application/data-fetching/incremental-static-regeneration).
 *
 * Alternatively, you can manually use `getEncodedLekkoConfigs` in your `getStaticProps`.
 */
export function withLekkoStaticProps(getStaticPropsFn?: GetStaticProps): GetStaticProps {
  return async (context: GetStaticPropsContext) => {
    const lekkoConfigs = await getEncodedLekkoConfigs();

    const origRet = await getStaticPropsFn?.(context);
    const origProps = origRet !== undefined && "props" in origRet ? origRet.props : undefined;

    return {
      ...origRet,
      props: {
        ...origProps,
        ...lekkoConfigs,
      },
    };
  };
}
