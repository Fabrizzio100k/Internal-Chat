export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-muted/40 to-background px-4">
      {children}
    </main>
  );
}
