# @lekko/next-sdk

## Usage

In `app/layout.tsx`:

```typescript
import { LekkoNextProvider } from "@lekko/next-sdk/server";

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

In any client component:

```typescript
"use client";

import { useLekkoConfig } from "@lekko/next-sdk/client";
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
