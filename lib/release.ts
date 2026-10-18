/**
 * Where the Android app can actually be got, right now.
 *
 * Read from the environment rather than written into the page, so the site tells the truth at
 * every stage of a release without anybody editing a component on launch day. Nothing here
 * invents a destination: a button appears only once the address it points at exists.
 *
 * The three states, in the order a release goes through them:
 *
 *   1. Neither set - the app is not downloadable yet. The page says so and offers no button.
 *   2. `NEXT_PUBLIC_APK_URL` - a build hosted for testers. Labelled as a test build, because a
 *      direct APK is not the same promise as a store listing and should not look like one.
 *   3. `NEXT_PUBLIC_PLAY_URL` - the published listing. Takes precedence once it exists.
 *
 * A fabricated Play link is the specific thing this exists to prevent. A store URL for an app that
 * has not been published 404s for every visitor who taps it, and it is the kind of detail that is
 * easy to add "temporarily" and then ship.
 */
export type AndroidRelease =
  | { kind: "play"; url: string }
  | { kind: "testing"; url: string }
  | { kind: "unreleased" };

export function androidRelease(): AndroidRelease {
  const play = process.env.NEXT_PUBLIC_PLAY_URL?.trim();
  if (play) return { kind: "play", url: play };

  const apk = process.env.NEXT_PUBLIC_APK_URL?.trim();
  if (apk) return { kind: "testing", url: apk };

  return { kind: "unreleased" };
}

/**
 * iOS has not been started, and saying "coming soon" about work nobody has begun is the kind of
 * claim that quietly becomes a year old. The page offers to tell people instead.
 */
export const IOS_STATUS = "not-started" as const;
