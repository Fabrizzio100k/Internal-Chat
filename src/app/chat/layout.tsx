import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { LOGIN_EXPIRED_ROUTE } from "@/lib/app-routes";
import { listConversationsAction, listPendingRequestsAction } from "@/lib/actions/chat";
import { inboxTopic } from "@/lib/realtime-server";
import { ChatSidebar } from "@/components/chat/chat-sidebar";
import { SessionGuard } from "@/components/app/session-guard";
import { WhatsNewDialog } from "@/components/app/whats-new-dialog";
import { PresenceProvider } from "@/hooks/use-presence";
import { InboxProvider } from "@/hooks/use-inbox";
import { UnreadTotalProvider } from "@/hooks/use-unread-total";
import { SidebarProvider } from "@/hooks/use-sidebar";
import { FaviconBadge } from "@/components/chat/favicon-badge";
import { E2eeProvider } from "@/components/e2ee/e2ee-provider";
import { E2eeInboxSync } from "@/components/e2ee/e2ee-inbox-sync";

export default async function ChatLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) {
    redirect(LOGIN_EXPIRED_ROUTE);
  }

  const [conversations, pendingRequests, versionRow] = await Promise.all([
    listConversationsAction(),
    listPendingRequestsAction(),
    prisma.user.findUnique({
      where: { id: session.userId },
      select: { lastSeenVersion: true },
    }),
  ]);

  return (
    <PresenceProvider currentUserId={session.userId}>
      <InboxProvider topic={inboxTopic(session.userId)}>
        <E2eeProvider userId={session.userId} username={session.username}>
          <E2eeInboxSync />
          <UnreadTotalProvider>
            <SidebarProvider>
              <FaviconBadge />
              <SessionGuard />
              <WhatsNewDialog
                userId={session.userId}
                lastSeenVersion={versionRow?.lastSeenVersion ?? null}
              />
              <div className="flex h-dvh overflow-hidden bg-background">
                <ChatSidebar
                  currentUser={session}
                  initialConversations={conversations}
                  initialPendingRequests={pendingRequests}
                />
                <div className="flex flex-1 flex-col overflow-hidden">{children}</div>
              </div>
            </SidebarProvider>
          </UnreadTotalProvider>
        </E2eeProvider>
      </InboxProvider>
    </PresenceProvider>
  );
}
