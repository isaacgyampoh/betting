import type { Metadata } from "next";
import Link from "next/link";
import { Prose } from "@/components/prose";

export const metadata: Metadata = {
  title: "Delete your account",
  description: "How to delete your GameClaw account and what happens to your data.",
  alternates: { canonical: "/delete-account" },
};

/**
 * The account-deletion page Google Play requires.
 *
 * Play asks for a route that is reachable *without installing the app* - the reviewer opens this
 * URL in a browser - and asks that it state what is deleted, what is kept, and for how long. A
 * link that only works inside the app does not satisfy it, which is why this lives on the
 * marketing site rather than only in the Profile tab.
 *
 * It names the one thing people actually want to know before they press it: signing in again
 * afterwards does not bring the account back. The Google link is deleted along with everything
 * else, so a later sign-in starts an empty account rather than reopening this one.
 */
export default function DeleteAccountPage() {
  return (
    <Prose>
      <h1>Delete your account</h1>
      <p>
        You can delete your GameClaw account at any time. It takes effect immediately — there is no waiting period
        and no reactivation.
      </p>

      <h2>From the app</h2>
      <ol>
        <li>Open GameClaw and go to <strong>Profile</strong>.</li>
        <li>Choose <strong>Delete account</strong>.</li>
        <li>Confirm. You will be signed out on every device.</li>
      </ol>

      <h2>If you cannot use the app</h2>
      <p>
        This website does not sign anybody in, so there is no second place to press the button — if you have
        uninstalled the app, lost the phone, or lost access to the Google account you signed in with, email{" "}
        <a href="mailto:support@gameclaw.win">support@gameclaw.win</a> from the address the account used and we will
        delete it for you. Say &quot;delete my account&quot; and nothing else is needed.
      </p>
      <p>
        Reinstalling the app and signing in again is the fastest route if you still can. Deleting the app on its own
        does <strong>not</strong> delete the account.
      </p>

      <h2>What is deleted</h2>
      <ul>
        <li>Your profile: email address, name and photo.</li>
        <li>Your sign-in link to Google, and every session on every device.</li>
        <li>Every slip and selection you have built, loaded or converted.</li>
        <li>The teams and matches you follow, and your notification settings.</li>
        <li>Your device push tokens, so notifications stop.</li>
        <li>Your assistant usage history and any referral rewards.</li>
      </ul>

      <h2>What is kept, and why</h2>
      <ul>
        <li>
          <strong>Nothing that identifies you</strong> remains in the parts of the service that are shared, such as
          cached match data and booking codes already issued by a bookmaker. Those are not linked to your account.
        </li>
        <li>
          <strong>A booking code you have already placed at a bookmaker belongs to that bookmaker.</strong> Deleting
          your GameClaw account does not cancel a bet or close an account you hold with them. Contact the bookmaker
          directly for that.
        </li>
      </ul>

      <h2>Signing in again</h2>
      <p>
        Deletion removes the link between your Google account and GameClaw. If you sign in again later, you get a new,
        empty account. Your old slips and follows are not recoverable — by us or by you.
      </p>
      <p>
        That includes a <strong>self-exclusion</strong> you have set: it is stored on the account, so deleting the
        account ends it. If you are using self-exclusion to take a break, use it rather than deleting your account, and
        contact <a href="mailto:support@gameclaw.win">support@gameclaw.win</a> if you need a longer block.
      </p>

      <p>
        See the <Link href="/privacy">privacy policy</Link> for what we collect while the account exists.
      </p>
    </Prose>
  );
}
