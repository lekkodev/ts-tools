import { type PropsWithChildren } from "react";
import { GetRepositoryContentsResponse } from "@lekko/js-sdk/internal";
import { createEnvelopeReadableStream } from "@connectrpc/connect/protocol";
import {
  trailerFlag,
  trailerParse,
} from "@connectrpc/connect/protocol-grpc-web";
import { fromUint8Array } from "js-base64";
import { LekkoClientProvider } from "./client";

const getRepositoryContents = async (
  apiKey: string,
  repositoryOwner: string,
  repositoryName: string,
  revalidate: number | false,
) => {
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
};

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
  const apiKey = process.env.NEXT_PUBLIC_LEKKO_API_KEY;
  const repositoryOwner = process.env.NEXT_PUBLIC_LEKKO_REPOSITORY_OWNER;
  const repositoryName = process.env.NEXT_PUBLIC_LEKKO_REPOSITORY_NAME;

  let encodedContents: string | undefined;
  if (mode === "production") {
    if (
      apiKey === undefined ||
      repositoryOwner === undefined ||
      repositoryName === undefined
    ) {
      console.warn(
        "Missing Lekko environment variables, make sure NEXT_PUBLIC_LEKKO_API_KEY, NEXT_PUBLIC_LEKKO_REPOSITORY_OWNER, NEXT_PUBLIC_LEKKO_REPOSITORY_NAME are set. Defaulting to static fallback.",
      );
    } else {
      try {
        const contents = await getRepositoryContents(
          apiKey,
          repositoryOwner,
          repositoryName,
          revalidate ?? 15,
        );
        encodedContents = fromUint8Array(contents.toBinary());
      } catch (e) {
        console.warn(
          `Failed to fetch and encode config repository contents, defaulting to static fallback: ${(e as Error).message}`,
        );
      }
    }
  }
  return (
    <LekkoClientProvider encodedRepoContents={encodedContents}>
      {children}
    </LekkoClientProvider>
  );
}
