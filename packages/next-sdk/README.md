# @lekko/next-sdk

## Usage

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

Example config function:

```typescript
// lekko/default.ts
export function getSomeConfig(): string {
  return "Hi, I'm a config function!";
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

// This can also be used in getStaticProps
export const getServerSideProps: GetServerSideProps = async () => {
  const lekkoConfigs = await getEncodedLekkoConfigs();
  return {
    props: {
      lekkoConfigs, // This is extracted and passed to LekkoClientProvider in _app.tsx
    },
  };
};
```

Note if a page doesn't receive the config contents, its sub-component tree will not be able to use dynamic production values of Lekko configs and will use the static fallback instead.
