import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listMessagesAroundUnchecked, listMessagesPageUnchecked } from "@/lib/messages-server";
import { ChatWindow } from "@/components/chat/chat-window";

export default async function ConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ conversationId: string }>;
  searchParams: Promise<{ m?: string | string[] }>;
}) {
  const [{ conversationId }, { m }] = await Promise.all([params, searchParams]);
  const session = await getSession();
  if (!session) {
    notFound();
  }

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      isGroup: true,
      name: true,
      participants: {
        select: { userId: true, role: true, user: { select: { id: true, username: true } } },
      },
    },
  });

  const me = conversation?.participants.find((p) => p.userId === session.userId);
  if (!conversation || !me) {
    notFound();
  }

  const members = conversation.participants.map((p) => ({ ...p.user, role: p.role }));
  const otherUser = conversation.isGroup
    ? null
    : (members.find((u) => u.id !== session.userId) ?? { id: "", username: "Usuario" });

  // ?m=<messageId>: viene de la búsqueda; carga una ventana alrededor del mensaje.
  const targetMessageId = typeof m === "string" && m ? m : undefined;
  const around = targetMessageId
    ? await listMessagesAroundUnchecked(conversationId, targetMessageId)
    : null;

  // La pertenencia ya se validó arriba.
  const { messages, hasMore } = around ?? (await listMessagesPageUnchecked(conversationId));

  return (
    <ChatWindow
      key={`${conversationId}:${around ? targetMessageId : ""}`}
      conversationId={conversationId}
      currentUser={session}
      isGroup={conversation.isGroup}
      title={conversation.isGroup ? (conversation.name ?? "Grupo") : (otherUser?.username ?? "Usuario")}
      otherUser={otherUser}
      members={members}
      myRole={me.role}
      initialMessages={messages}
      initialHasMore={hasMore}
      highlightMessageId={around ? targetMessageId : undefined}
    />
  );
}
