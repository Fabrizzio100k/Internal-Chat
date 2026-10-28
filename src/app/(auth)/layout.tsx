export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center sky-backdrop bg-background px-4">
      {children}
    </main>
  );
}
