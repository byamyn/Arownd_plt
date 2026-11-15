const { withGradleProperties } = require("@expo/config-plugins");

/**
 * Build distributable Android variants for 64-bit ARM devices only.
 * This excludes 32-bit ARM and x86/x86_64 native libraries from the APK.
 */
module.exports = function withArm64Only(config) {
  return withGradleProperties(config, (config) => {
    const properties = config.modResults;
    const propertyName = "reactNativeArchitectures";

    const existing = properties.filter(
      (property) => property.type !== "property" || property.key !== propertyName
    );

    existing.push({
      type: "property",
      key: propertyName,
      value: "arm64-v8a",
    });

    config.modResults = existing;
    return config;
  });
};
