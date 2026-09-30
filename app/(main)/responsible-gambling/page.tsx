import type { Metadata } from "next";
import { Prose } from "@/components/prose";

export const metadata: Metadata = { title: "Responsible gambling" };

export default function ResponsibleGamblingPage() {
  return (
    <Prose>
      <h1>Responsible gambling</h1>
      <p>
        <strong>gameclaw is for adults aged 18 and over.</strong> Betting should be entertainment, never a way to make
        money or solve financial problems.
      </p>
      <h2>Stay in control</h2>
      <ul>
        <li>Set a budget before you bet and stick to it. Only stake money you can afford to lose.</li>
        <li>Set a time limit. Take regular breaks.</li>
        <li>Never chase losses by betting more to win back what you lost.</li>
        <li>Don&apos;t bet when you are stressed, upset or under the influence of alcohol.</li>
        <li>Remember: odds, stats and AI analysis describe probabilities. No prediction is guaranteed.</li>
      </ul>
      <h2>Warning signs</h2>
      <ul>
        <li>Spending more money or time on betting than you planned.</li>
        <li>Borrowing money, or using money meant for bills, food or school fees, to bet.</li>
        <li>Hiding your betting from family or friends.</li>
        <li>Feeling anxious or irritable when you are not betting.</li>
      </ul>
      <h2>Get help</h2>
      <p>If betting is causing you problems, talk to someone you trust and reach out for support:</p>
      <ul>
        <li>
          Your bookmaker&apos;s responsible gambling tools: deposit limits, time-outs and self-exclusion are available in
          your bookmaker account settings.
        </li>
        <li>
          Gaming Commission of Ghana: <a href="https://www.gamingcommission.gov.gh" target="_blank" rel="noopener noreferrer">gamingcommission.gov.gh</a>
        </li>
        <li>
          Gamblers Anonymous: <a href="https://www.gamblersanonymous.org" target="_blank" rel="noopener noreferrer">gamblersanonymous.org</a>
        </li>
        <li>
          GamCare (free advice and tools): <a href="https://www.gamcare.org.uk" target="_blank" rel="noopener noreferrer">gamcare.org.uk</a>
        </li>
      </ul>
    </Prose>
  );
}
