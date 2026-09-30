import type { Metadata } from "next";
import { z } from "zod";
import { ChatWorkspace } from "@/components/chat/chat-workspace";
import { ApiErrorNotice } from "@/components/api-error-notice";
import { requireAdultPage } from "@/lib/auth-pages";
import { env } from "@/lib/env";
import { getAiAllowance } from "@/lib/services/ai-quota";

export const metadata: Metadata = { title: "Chat" };

export default async function ChatPage({ searchParams }: PageProps<"/chat">) {
  const { user } = await requireAdultPage("/chat");
  const match = z.coerce.number().int().positive().optional().catch(undefined).parse((await searchParams).match);

  if (!env().ANTHROPIC_API_KEY) {
    return <ApiErrorNotice code="AI_UNAVAILABLE" message="Chat isn't available right now." />;
  }
  const allowance = await getAiAllowance(user.id);
  return <ChatWorkspace initialAllowance={allowance} matchId={match} />;
}
