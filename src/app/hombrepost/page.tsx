import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { LOGIN_EXPIRED_ROUTE } from "@/lib/app-routes";
import { HombrePostApp } from "@/components/hombrepost/hombrepost-app";

export const metadata: Metadata = {
  title: "HombrePost",
  description: "Cliente HTTP interno: peticiones con headers, body, forms y auth",
};

export default async function HombrePostPage() {
  const session = await getSession();
  if (!session) {
    redirect(LOGIN_EXPIRED_ROUTE);
  }

  return <HombrePostApp />;
}
