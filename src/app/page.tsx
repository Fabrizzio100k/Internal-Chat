import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { LAUNCHER_ROUTE } from "@/lib/app-routes";

export default async function Home() {
  const session = await getSession();

  if (session) {
    redirect(LAUNCHER_ROUTE);
  }

  redirect("/login");
}
