import webpack from "webpack";
import { errors } from "@lekko/ts-transformer";

// It's not clear why, but for custom error types we need to register a Webpack serializer
// to prevent errors that look like "No serializer registered for LekkoFunctionError"
Object.values(errors).forEach((ErrorClass) => {
  // https://github.com/webpack/changelog-v5/blob/master/guides/persistent-caching.md#serialization
  webpack.util.serialization.register(
    ErrorClass,
    "@lekko/webpack-loader",
    ErrorClass.name,
    {
      serialize() {},
      deserialize() {},
    },
  );
});
