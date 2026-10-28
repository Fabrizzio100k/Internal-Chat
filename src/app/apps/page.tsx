import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { LOGIN_EXPIRED_ROUTE } from "@/lib/app-routes";
import { AppLauncher } from "@/components/apps/app-launcher";
import { SessionMenu } from "@/components/apps/session-menu";
import { SessionGuard } from "@/components/app/session-guard";
import { WhatsNewDialog } from "@/components/app/whats-new-dialog";

export const metadata: Metadata = {
  title: "Apps internas",
  description: "Selector de apps internas del equipo",
};

export default async function AppsPage() {
  const session = await getSession();
  if (!session) {
    redirect(LOGIN_EXPIRED_ROUTE);
  }

  const userRow = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { lastSeenVersion: true, avatar: true },
  });

  return (
    <div className="sky-backdrop flex min-h-screen flex-col bg-background">
      <SessionGuard />
      <WhatsNewDialog userId={session.userId} lastSeenVersion={userRow?.lastSeenVersion ?? null} />
      <header className="glass flex items-center justify-between gap-4 border-b px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <h1 className="font-heading text-base leading-tight font-medium">Apps internas</h1>
          <p className="truncate text-xs text-muted-foreground">
            Hola, {session.username}. Elige una app para empezar.
          </p>
        </div>
        <SessionMenu username={session.username} avatar={userRow?.avatar ?? null} />
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6">
        <AppLauncher />
      </main>
    </div>
  );
}
