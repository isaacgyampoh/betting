import type { Metadata } from "next";
import Link from "next/link";
import { Prose } from "@/components/prose";

export const metadata: Metadata = {
  title: "Support",
  description: "Get help with GameClaw: contact, common problems, and account questions.",
  alternates: { canonical: "/support" },
};

/**
 * The support page.
 *
 * Apple asks every App Store listing for a Support URL and a reviewer opens it, so /support
 * returning 404 is a rejection on its own. It was 404 because the route simply did not exist -
 * worker.ts never touched it, and the marketing app had privacy, terms, delete-account,
 * responsible-gambling, pricing and track-record but nothing here.
 *
 * One thing to fix before this goes live: gameclaw.win has **no MX records**, so
 * support@gameclaw.win cannot receive mail and anything sent there bounces. That is not a problem
 * this page introduces - privacy and delete-account have both published that address for a while,
 * which means the contact route promised for data-protection requests is already broken. Point MX
 * at a mailbox first; a support page whose only contact bounces is worse than no support page,
 * because it reads as an answer.
 *
 * Written for someone who is stuck, not for a reviewer. The questions below are the ones that have
 * actually come up: a booking code that will not read, Google sign-in failing, a converted slip
 * whose code is unchanged, and how to get an account deleted.
 */
export default function SupportPage() {
  return (
    <Prose>
      <h1>Support</h1>
      <p>
        Something not working, or a question about your account? Email{" "}
        <a href="mailto:support@gameclaw.win">support@gameclaw.win</a> and tell us what happened, what you expected,
        and which phone you are on. We read everything that comes in.
      </p>
      <p>
        If it is about a specific slip or booking code, include the code. It is the fastest way for us to see exactly
        what you saw.
      </p>

      <h2>Common problems</h2>

      <p>
        <strong>A booking code will not load.</strong> Codes expire — most bookmakers drop them after a few days, and
        once a game has kicked off the slip can no longer be read. Check the code is from a bookmaker GameClaw can
        read: the Convert screen lists every one, and says why any that are missing are unavailable. If the same code
        works on the bookmaker&apos;s own site but not here, send it to us.
      </p>

      <p>
        <strong>The converted code looks identical to the one I pasted.</strong> That is correct, not a failure. Some
        bookmakers run on the same underlying platform and share booking codes, so a code converted between two of
        them comes back unchanged and opens on both. The app says so on the result screen when it happens.
      </p>

      <p>
        <strong>Some selections did not carry across.</strong> The destination bookmaker did not offer that game, or
        did not offer that market on it. The result screen names each one it could not carry rather than quietly
        dropping it, and the odds shown are always the destination&apos;s own — where a market differs, it is not the
        same slip.
      </p>

      <p>
        <strong>Signing in with Google fails.</strong> Make sure the phone has a working connection and try again; if
        it still fails, tell us which phone and what the message said. On Android, installing from a file rather than
        the Play Store can also cause this, and that one is on us to fix rather than you.
      </p>

      <p>
        <strong>Scanning a screenshot finds nothing.</strong> Use a full, uncropped screenshot taken on the phone
        rather than a photograph of another screen. Reflections, glare and angle defeat the text recognition. The
        image is read on your phone and never uploaded.
      </p>

      <p>
        <strong>Match alerts are not arriving.</strong> Check notifications are allowed for GameClaw in your phone
        settings, that you are following the team or match, and that it is not muted. Profile has a{" "}
        <strong>Send a test notification</strong> button that tells you where the chain is breaking.
      </p>

      <h2>Your account</h2>
      <p>
        To delete your account and everything attached to it, see{" "}
        <Link href="/delete-account">deleting your account</Link>. It takes effect immediately and signing in again
        afterwards starts an empty account rather than restoring the old one.
      </p>
      <p>
        For a copy of what we hold about you, or to correct it, email the address above. What we collect and how long
        we keep it is set out in the <Link href="/privacy">privacy policy</Link>.
      </p>

      <h2>Before you bet</h2>
      <p>
        GameClaw is for people aged 18 and over. Every chance it shows is an estimate from past results, never a
        certainty, and a long price is long for a reason. If betting has stopped being enjoyable, the{" "}
        <Link href="/responsible-gambling">responsible gambling</Link> page has the tools built into the app and where
        to find help.
      </p>

      <h2>The terms</h2>
      <p>
        Using GameClaw means accepting the <Link href="/terms">terms of service</Link>. GameClaw does not take bets,
        hold money, or pay out winnings — bets are placed with the bookmaker, under their terms.
      </p>
    </Prose>
  );
}
