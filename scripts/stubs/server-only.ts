// A no-op stand-in for the `server-only` package, used only by scripts run with
// tsconfig.scripts.json.
//
// The real package throws unless it is being bundled for a React Server Component, which is
// exactly what we want in the app: it is what stops a module holding a provider key from ever
// being pulled into a client bundle. A command-line script is neither, so it needs this.
//
// Deliberately scoped to tsconfig.scripts.json rather than the main tsconfig. Mapping it globally
// would switch the protection off everywhere to make one script run.
export {};
