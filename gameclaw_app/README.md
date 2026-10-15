# GameClaw mobile

A Flutter application. Not a wrapper: the UI is rendered by Flutter and the app loads no website.

## Requirements

- Flutter **3.47.7** or newer (3.35 cannot resolve `drift_dev`)
- JDK **21**. Gradle 8.12 rejects Java 25, which is what Flutter picks up by default on this
  machine, so point it at 21 once: `flutter config --jdk-dir=$(/usr/libexec/java_home -v 21)`
- Android SDK with platform 35+

## Running

```bash
flutter pub get
flutter analyze
flutter test
flutter build apk --debug
```

## The backend

The app needs an API for everything it shows. It holds a user's session token and nothing else:
the football provider key, the bookmaker credentials and the database all stay server-side, where
a decompiled APK cannot reach them.

The host is a build flag, never hard-coded:

```bash
flutter build apk --debug --dart-define=GC_API_BASE=https://<host>/api/v1
```

Without the flag it points at `http://10.0.2.2:3000/api/v1`, which is how an Android emulator
reaches a server running on the host machine.

**The production host is undecided.** The existing Cloudflare Worker already serves this API
contract and is already paid for, so a second hostname on it is the cheapest route; a separate
deployment is the alternative. Nothing in the code depends on which is chosen.

## Layout

```
lib/
  app/        navigation shell and router
  data/       API client, failures, (later) local cache
  domain/     models - the app's own view of football
  features/   one directory per tab
  theme/      design tokens
```

## Two rules the code enforces

**Missing is not zero.** A competition that publishes no score and a match that genuinely finished
0-0 are different facts. Anything a provider may not supply is nullable, and a screen must handle
null as "not published" rather than as a number. `Coverage` travels with the data so an empty list
can be told apart from a competition that never publishes one.

**Nothing is invented.** No screen shows a fixture, score, statistic, price or booking code that
did not come from the server. A screen with no data yet says so.
