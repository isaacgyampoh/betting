import type { Metadata } from "next";
import { Prose } from "@/components/prose";

export const metadata: Metadata = { title: "Privacy policy" };

// Draft policy. Review against Ghana's Data Protection Act, 2012 (Act 843) before launch.
export default function PrivacyPage() {
  return (
    <Prose>
      <h1>Privacy policy</h1>
      <p>Last updated: 30 September 2026</p>
      <h2>What we collect</h2>
      <ul>
        <li>Account data: your email address, and name and photo if you sign in with Google.</li>
        <li>Your age confirmation and when you gave it.</li>
        <li>Slips and booking codes you load, convert or edit.</li>
        <li>Messages you send to the AI assistant, and usage counts used to enforce plan limits.</li>
        <li>Payment records from Paystack (we never see or store your card or mobile money PIN).</li>
        <li>A one-way hash of your IP address for rate limiting. We don&apos;t store the raw IP.</li>
      </ul>
      <h2>How we use it</h2>
      <p>
        To run the service, enforce limits, prevent abuse, process payments and improve gameclaw. We do not sell your
        personal data.
      </p>
      <h2>Who we share it with</h2>
      <p>
        Service providers that help us run gameclaw: Supabase (database and sign-in), Vercel (hosting), Anthropic (AI
        processing of your chat messages), API-Football (match data, no personal data sent) and Paystack (payments).
      </p>
      <h2>Your rights</h2>
      <p>
        You can ask to access, correct or delete your data at any time. Deleting your account removes your profile, slips
        and chat history.
      </p>
    </Prose>
  );
}
