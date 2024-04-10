import { type PropsWithChildren } from "react";
import { GetRepositoryContentsResponse } from "@lekko/js-sdk/internal";
import { createEnvelopeReadableStream } from "@connectrpc/connect/protocol";
import {
  trailerFlag,
  trailerParse,
} from "@connectrpc/connect/protocol-grpc-web";
import { fromUint8Array } from "js-base64";
import { LekkoClientProvider } from "./client";
import { type EncodedLekkoConfigs } from "./types";

async function getRepositoryContents(
  apiKey: string,
  repositoryOwner: string,
  repositoryName: string,
  revalidate: number | false,
) {
  const response = await fetch(
    "https://relay.lekko-cdn.com/" +
      btoa(`${repositoryOwner}/${repositoryName}/${apiKey}`),
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
  mode,
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
  mode?: "production" | "development" | "test";
} = {}): Promise<EncodedLekkoConfigs | null> {
  mode ??= process.env.NODE_ENV;
  apiKey ??= process.env.NEXT_PUBLIC_LEKKO_API_KEY;
  repositoryOwner ??= process.env.NEXT_PUBLIC_LEKKO_REPOSITORY_OWNER;
  repositoryName ??= process.env.NEXT_PUBLIC_LEKKO_REPOSITORY_NAME;

  if (mode === "production") {
    if (
      apiKey === undefined ||
      repositoryOwner === undefined ||
      repositoryName === undefined
    ) {
      console.warn(
        "Missing Lekko environment variables, make sure NEXT_PUBLIC_LEKKO_API_KEY, NEXT_PUBLIC_LEKKO_REPOSITORY_OWNER, NEXT_PUBLIC_LEKKO_REPOSITORY_NAME are set. Evaluation will default to static fallback.",
      );
      return null;
    }
    try {
      const contents = await getRepositoryContents(
        apiKey,
        repositoryOwner,
        repositoryName,
        revalidate ?? 15,
      );
      return fromUint8Array(contents.toBinary());
    } catch (e) {
      console.warn(
        `Failed to fetch and encode config repository contents, will default to static fallback: ${(e as Error).message}`,
      );
    }
  }
  // No need for fetch in local development
  return null;
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
  /**
   * In development mode, the Lekko SDK client is not fully initialized
   * and does not connect to Lekko's services. In production mode, Lekko-related
   * environment variables are required and the SDK client will connect to Lekko
   * to fetch configs and send evaluation metrics.
   *
   * Defaults to read from `process.env.NODE_ENV`.
   */
  mode?: "development" | "production" | "test";
}

/**
 * This provider is only compatible with the App Router. For Pages Router, see LekkoClientProvider.
 *
 * This server-side provider should be placed high in the component tree (e.g. root layout).
 * Client components under it in the component tree will be able to use `useLekkoConfig`
 * to evaluate configs.
 */
export async function LekkoNextProvider({
  revalidate,
  mode,
  children,
}: LekkoNextProviderProps) {
  mode ??= process.env.NODE_ENV;

  const encodedContents = await getEncodedLekkoConfigs({ revalidate, mode });
  return (
    <LekkoClientProvider configs={encodedContents}>
      {children}
    </LekkoClientProvider>
  );
}

export { type EncodedLekkoConfigs };
