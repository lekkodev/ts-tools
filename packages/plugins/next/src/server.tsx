// it'd be nice to do "use server"
//@ts-ignore
import { cache, type PropsWithChildren } from "react";
import { createEnvelopeReadableStream } from "@connectrpc/connect/protocol"
import { trailerFlag, trailerParse, } from "@connectrpc/connect/protocol-grpc-web";
import { GetRepositoryContentsResponse } from "./gen/lekko/backend/v1beta1/distribution_service_pb"
import { LekkoClientProvider } from "./client";
export { useLekkoConfig } from "./client";
export  { ClientContext } from "./context";
var base64 = require('base-64');


// TODO better name
export const getRepo = cache(async () => {
  const response = await fetch(
    `https://ts-relay.lekkorelay.workers.dev/${process.env.NEXT_PUBLIC_LEKKO_REPOSITORY_OWNER}/${process.env.NEXT_PUBLIC_LEKKO_REPOSITORY_NAME}/${process.env.NEXT_PUBLIC_LEKKO_API_KEY}`,
  );
  if (!response.ok || !response.body) {
    return null;
  }
  const reader = createEnvelopeReadableStream(response.body).getReader();
  let trailer;
  let message;
  for (;;) {
    const r = await reader.read();
    if (r.done) {
      break;
    }
    const { flags, data } = r.value;
    if (flags === trailerFlag) {
      if (trailer !== undefined) {
        throw "extra trailer";
      }
      // Unary responses require exactly one response message, but in
      // case of an error, it is perfectly valid to have a response body
      // that only contains error trailers.
      trailer = trailerParse(data);
      continue;
    }
    if (message !== undefined) {
      throw "extra message";
    }
    message= GetRepositoryContentsResponse.fromBinary(data);
  }
  // todo handle trailer? - if anything changes to connect we don't even get it though
  return message;
});


export async function LekkoNextProvider({ children }: PropsWithChildren) {
  return (
    <LekkoClientProvider
      repo={ base64.encode((await getRepo()).toBinary()) }
    >
    {children}
    </LekkoClientProvider>
  );
}
