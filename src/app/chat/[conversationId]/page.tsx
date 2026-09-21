import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listMessagesPageUnchecked } from "@/lib/actions/messages";
import { ChatWindow } from "@/components/chat/chat-window";

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  const session = await getSession();
  if (!session) {
    notFound();
  }

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: {
      participants: {
        include: { user: { select: { id: true, username: true } } },
      },
    },
  });

  const myParticipation = conversation?.participants.find((p) => p.userId === session.userId);
  if (!conversation || !myParticipation) {
    notFound();
  }

  const otherUser = conversation.participants.find((p) => p.userId !== session.userId)?.user ?? {
    id: "",
    username: "Usuario",
  };

  // La pertenencia ya se validó arriba con la misma query que necesitamos
  // para obtener otherUser, así que evitamos repetir esa validación aquí.
  const { messages, hasMore } = await listMessagesPageUnchecked(conversationId);

  return (
    <ChatWindow
      key={conversationId}
      conversationId={conversationId}
      currentUser={session}
      otherUser={otherUser}
      initialMessages={messages}
      initialHasMore={hasMore}
    />
  );
}
