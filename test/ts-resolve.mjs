/**
 * Resolve hook: let Node follow the `./thing.js` specifiers the source uses.
 *
 * The app is written for a bundler, where a relative `.js` import resolves to
 * the `.ts` file beside it. Node does no such rewriting, so its test runner
 * cannot follow any module that imports a *value* from a sibling — which is
 * every module worth testing.
 *
 * The alternative was `allowImportingTsExtensions` and rewriting every import
 * in the codebase to `.ts`, which makes the source less portable to serve a
 * test runner. This is four lines and touches nothing.
 */
export async function resolve(specifier, context, next) {
  if (specifier.startsWith('.') && specifier.endsWith('.js')) {
    try {
      return await next(specifier.slice(0, -3) + '.ts', context);
    } catch {
      // No sibling `.ts` — it really was a `.js` file. Fall through.
    }
  }
  return next(specifier, context);
}
