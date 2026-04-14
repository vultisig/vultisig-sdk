const path = require('node:path');
const {
  withAppBuildGradle,
  createRunOncePlugin,
} = require('@expo/config-plugins');

/**
 * AGP 9+ refuses direct local .aar dependencies inside an Android library
 * module — it can't bundle them into the resulting AAR cleanly. So this
 * package's `android/build.gradle` declares the prebuilt dkls/goschnorr
 * AARs as `compileOnly` (Kotlin sees the SWIG classes for compilation),
 * and this Expo config plugin re-declares them as `implementation files(...)`
 * at the consuming **app** module level — where direct .aar deps are still
 * fine. That puts the .so JNI libs on the final APK's runtime classpath.
 *
 * Consumers wire it up by adding `@vultisig/mpc-native` to their `app.json`
 * `plugins` array. The plugin is idempotent — a marker comment guards
 * against double-injection on repeated `expo prebuild` runs.
 */
const MARKER = '// mpc-native-aars (managed by @vultisig/mpc-native)';

function buildBlock(repoRelativePath) {
  return [
    `    ${MARKER}`,
    `    implementation files("$rootDir/../${repoRelativePath}/dkls-release.aar")`,
    `    implementation files("$rootDir/../${repoRelativePath}/goschnorr-release.aar")`,
  ].join('\n');
}

const withMpcNativeAars = config =>
  withAppBuildGradle(config, modConfig => {
    if (modConfig.modResults.contents.includes(MARKER)) {
      return modConfig;
    }

    // Compute the repo-relative path from the consumer project root to the
    // mpc-native package's android/libs directory. Resolving from this
    // plugin's own __dirname guarantees the right path regardless of how
    // npm/pnpm/yarn placed the package on disk (file: link, hoisted, etc.)
    const projectRoot = modConfig.modRequest.projectRoot;
    const aarsDir = path.relative(
      projectRoot,
      path.resolve(__dirname, 'android', 'libs'),
    );

    // Match the opening `dependencies {` line with any trailing whitespace
    // (LF or CRLF — Windows checkouts via core.autocrlf=true ship CRLF files).
    const dependenciesRegex = /dependencies\s*\{[ \t]*\r?\n/;
    if (!dependenciesRegex.test(modConfig.modResults.contents)) {
      throw new Error(
        '[@vultisig/mpc-native] could not find dependencies block in android/app/build.gradle',
      );
    }

    modConfig.modResults.contents = modConfig.modResults.contents.replace(
      dependenciesRegex,
      match => `${match}${buildBlock(aarsDir)}\n`,
    );

    return modConfig;
  });

module.exports = createRunOncePlugin(
  withMpcNativeAars,
  '@vultisig/mpc-native',
  '1.0.0',
);
