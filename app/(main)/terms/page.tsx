import type { Metadata } from "next";
import Link from "next/link";
import { Prose } from "@/components/prose";

export const metadata: Metadata = { title: "Terms of use" };

// Draft terms. Have them reviewed by a Ghanaian lawyer before launch.
export default function TermsPage() {
  return (
    <Prose>
      <h1>Terms of use</h1>
      <p>Last updated: 30 September 2026</p>
      <h2>1. Who we are</h2>
      <p>
        gameclaw is an information and productivity tool for sports bettors. <strong>We are not a bookmaker.</strong> We
        do not accept bets, hold your funds or pay out winnings. All bets are placed by you, directly with your
        bookmaker, under their terms.
      </p>
      <h2>2. Eligibility</h2>
      <p>You must be at least 18 years old and legally allowed to bet where you live to use gameclaw.</p>
      <h2>3. No guarantees</h2>
      <p>
        Odds, fixtures, statistics and booking codes come from third parties and can change or be wrong. AI answers and
        match analysis are opinions based on that data. <strong>Predictions are not guaranteed.</strong> You are solely
        responsible for your betting decisions and any losses.
      </p>
      <h2>4. Booking codes and conversions</h2>
      <p>
        Converted slips are matched automatically and may differ from the original (for example, a game or market may not
        be available at the target bookmaker). Always check the slip on the bookmaker&apos;s site before you place a bet.
      </p>
      <h2>5. Paid plans</h2>
      <p>
        Paid plans are billed in Ghana cedis via Paystack for the period shown at checkout. Plan limits and prices are shown
        before you pay. Fees are non-refundable except where required by law.
      </p>
      <h2>6. Fair use</h2>
      <p>
        Don&apos;t abuse, scrape or overload the service, resell access, or use it for anything unlawful. We may apply rate
        limits and suspend accounts that break these terms.
      </p>
      <h2>7. Independence</h2>
      <p>
        gameclaw is independent and not affiliated with, endorsed by or sponsored by any bookmaker. Bookmaker names are used
        only to identify compatible services.
      </p>
      <h2>8. Changes</h2>
      <p>We may update these terms; continued use after changes means you accept them.</p>
      <p>
        See also our <Link href="/privacy">Privacy Policy</Link> and <Link href="/responsible-gambling">Responsible gambling</Link> page.
      </p>
    </Prose>
  );
}
