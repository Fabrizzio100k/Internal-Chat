import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { AppLauncher } from "@/components/apps/app-launcher";
import { SessionMenu } from "@/components/apps/session-menu";

export const metadata: Metadata = {
  title: "Apps internas",
  description: "Selector de apps internas del equipo",
};

export default async function AppsPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center justify-between gap-4 border-b px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <h1 className="font-heading text-base leading-tight font-medium">Apps internas</h1>
          <p className="truncate text-xs text-muted-foreground">
            Hola, {session.username}. Elige una app para empezar.
          </p>
        </div>
        <SessionMenu username={session.username} />
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6">
        <AppLauncher />
      </main>
    </div>
  );
}
