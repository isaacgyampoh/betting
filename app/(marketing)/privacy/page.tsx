import type { Metadata } from "next";
import Link from "next/link";
import { Prose } from "@/components/prose";

export const metadata: Metadata = { title: "Privacy policy", alternates: { canonical: "/privacy" } };

/**
 * Written against the schema rather than from memory.
 *
 * Google Play's Data safety form has to match this page, and a mismatch between the two is a
 * review failure. Every item below corresponds to a real table in `prisma/schema.prisma`; the
 * previous draft listed payment records that are not collected (Paystack is not configured and
 * the server reports `payments: false`) while omitting push tokens and followed teams, which are.
 *
 * Review against Ghana's Data Protection Act, 2012 (Act 843) before launch.
 */
export default function PrivacyPage() {
  return (
    <Prose>
      <h1>Privacy policy</h1>
      <p>Last updated: 19 October 2026</p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Your account</strong>: the email address, name and profile photo your Google account gives us, and
          the Google account identifier that links it to GameClaw.
        </li>
        <li>
          <strong>Your age confirmation</strong> and when you gave it. GameClaw is for over-18s only.
        </li>
        <li>
          <strong>Slips and booking codes</strong> you load, build, convert, merge or edit, and the selections in them.
        </li>
        <li>
          <strong>Teams and matches you follow</strong>, and whether you have muted them.
        </li>
        <li>
          <strong>Messages you send to the assistant</strong>, and counts of how often you use it, which is how plan
          limits are enforced.
        </li>
        <li>
          <strong>Push tokens</strong> for each device you turn notifications on for. These identify the device, not
          you, and are how a match alert reaches your phone.
        </li>
        <li>
          <strong>Sessions</strong>: a hashed token per signed-in device, with the device description your browser or
          phone reports, so you can be signed out everywhere when you ask.
        </li>
        <li>
          <strong>A one-way hash of your IP address</strong> for rate limiting. We do not store the address itself.
        </li>
        <li>
          If you set a <strong>spending note</strong> or a <strong>self-exclusion</strong>, we store it so we can show
          it back to you and honour it.
        </li>
      </ul>
      <p>
        We do not process payments today, so we hold no card, mobile money or billing records. If that changes this
        page will say so before it does.
      </p>

      <h2>How we use it</h2>
      <p>
        To run the service: sign you in, show the matches you follow, build and convert slips, send the alerts you
        asked for, enforce plan limits and prevent abuse. We do not sell your personal data, and we do not use it to
        advertise to you.
      </p>

      <h2>Who we share it with</h2>
      <ul>
        <li><strong>Render</strong> — hosting and the database.</li>
        <li><strong>Supabase</strong> — sign-in for the web app.</li>
        <li><strong>Cloudflare</strong> — hosting for this website.</li>
        <li><strong>Google Firebase</strong> — delivering push notifications to your device.</li>
        <li><strong>Anthropic</strong> — processing the messages you send to the assistant.</li>
        <li><strong>API-Football</strong> — match data. No personal data is sent to them.</li>
        <li><strong>Bookmakers</strong> — when you convert or place a slip, the selections in it go to the bookmaker
          you chose. Your GameClaw account details do not.</li>
      </ul>

      <h2>How long we keep it</h2>
      <p>
        For as long as your account exists. When you delete it, the data goes with it immediately — see{" "}
        <Link href="/delete-account">deleting your account</Link> for exactly what is removed and the few things that
        are not.
      </p>

      <h2>Your rights</h2>
      <p>
        You can access, correct or delete your data at any time. Deletion is immediate and available{" "}
        <Link href="/delete-account">from the app or this website</Link>, without contacting us. For anything else,
        email <a href="mailto:support@gameclaw.win">support@gameclaw.win</a>.
      </p>

      <h2>Children</h2>
      <p>
        GameClaw is not for anyone under 18, we do not knowingly collect data from under-18s, and we delete it if we
        find we have.
      </p>
    </Prose>
  );
}
