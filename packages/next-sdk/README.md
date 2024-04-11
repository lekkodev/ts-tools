# @lekko/next-sdk

## Usage

In your `next.config.js`, add the Lekko helper. This will perform build-time checks and transformations for your Lekko config functions.

Notice that this wrapper is imported from `@lekko/next-sdk/config` and not just `@lekko/next-sdk`.

```typescript
const { withLekkoNextConfig } = require("@lekko/next-sdk/config");

const nextConfig = {
  // Your regular Next.js configs go here
};

module.exports = withLekkoNextConfig(nextConfig);
```

In any client component, use the `useLekkoConfig` hook:

```typescript
"use client";

import { useLekkoConfig } from "@lekko/next-sdk";
// User-defined config functions
import { getSomeConfig } from "@/lekko/default";

...

export default function MyClientComponent() {
  // First arg is the config function to be evaluation, second arg is the evaluation context
  const config = useLekkoConfig(getSomeConfig, {});

  return (
    ...
  );
}
```

Example config functions:

```typescript
// lekko/default.ts

/** Description of some config */
export function getSomeConfig(): string {
  return "Hi, I'm a config function!";
}

/** This is a feature flag used somewhere in the app */
export function getMyFeatureFlag({ userId }: { userId: number }): boolean {
  if (userId === 15) {
    return true;
  }
  return false;
}
```

### App Router

In `app/layout.tsx` (or a similar top-level layout):

```typescript
import { LekkoNextProvider } from "@lekko/next-sdk";

...

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <LekkoNextProvider revalidate={10}>
          {children}
        </LekkoNextProvider>
      </body>
    </html>
  );
}
```

The `LekkoNextProvider` is responsible for connecting to Lekko's services and hydrating client-side code with up-to-date config values.

It makes the `useLekkoConfig` hook available to use in client components.

### Pages Router

In `pages/_app.tsx` (or a similar top-level layout):

```typescript
import { LekkoClientProvider } from "@lekko/next-sdk";

...

export default function App({ Component, pageProps }: AppProps) {
  return (
    // We populate the `lekkoConfigs` prop below
    <LekkoClientProvider configs={pageProps.lekkoConfigs}>
      <Component {...pageProps} />
    </LekkoClientProvider>
  );
}
```

Then, in each page you want to use the `useLekkoConfig` hook under:

```typescript
import { useLekkoConfig, withLekkoServerSideProps } from "@lekko/next-sdk";
// User-defined config functions
import { getSomeConfig } from "@/lekko/default";

export default function SomePage() {
  const config = useLekkoConfig(getSomeConfig, {});

  return (...);
}

// Wrap your custom getServerSideProps
export const getServerSideProps = withLekkoServerSideProps(...);
// Alternatively, for statically rendered pages...
export const getStaticProps = withLekkoStaticProps(...);
```

Note if a page doesn't receive the config contents, its sub-component tree will not be able to use dynamic production values of Lekko configs and will use the static fallback instead.
