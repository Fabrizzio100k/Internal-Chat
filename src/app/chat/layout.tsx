import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { listConversationsAction, listPendingRequestsAction } from "@/lib/actions/chat";
import { ChatSidebar } from "@/components/chat/chat-sidebar";
import { PresenceProvider } from "@/hooks/use-presence";

export default async function ChatLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const [conversations, pendingRequests] = await Promise.all([
    listConversationsAction(),
    listPendingRequestsAction(),
  ]);

  return (
    <PresenceProvider currentUserId={session.userId}>
      <div className="flex h-screen overflow-hidden bg-background">
        <ChatSidebar
          currentUser={session}
          initialConversations={conversations}
          initialPendingRequests={pendingRequests}
        />
        <div className="flex flex-1 flex-col overflow-hidden">{children}</div>
      </div>
    </PresenceProvider>
  );
}
