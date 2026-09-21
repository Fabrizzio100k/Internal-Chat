"use client";

import { useActionState, useEffect, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { registerSchema, type RegisterInput } from "@/lib/validations/auth";
import { registerAction } from "@/lib/actions/auth";
import type { AuthActionResult } from "@/lib/types/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";

const initialState: AuthActionResult = { success: false };

export function RegisterForm() {
  const [state, formAction] = useActionState(registerAction, initialState);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  useEffect(() => {
    if (state.success) {
      router.push("/chat");
      router.refresh();
    }
  }, [state.success, router]);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
  });

  const onValid = (data: RegisterInput) => {
    const formData = new FormData();
    formData.set("username", data.username);
    formData.set("password", data.password);
    startTransition(() => {
      formAction(formData);
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
    >
      <Card className="w-full max-w-sm shadow-lg">
        <CardHeader>
          <CardTitle className="text-xl">Crea tu cuenta</CardTitle>
          <CardDescription>Elige un usuario y contraseña para empezar a chatear</CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit(onValid)}>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="username">Usuario</Label>
              <Input
                id="username"
                autoComplete="username"
                placeholder="tu_usuario"
                {...register("username")}
              />
              {errors.username && (
                <p className="text-xs text-destructive">{errors.username.message}</p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Contraseña</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                placeholder="••••••••"
                {...register("password")}
              />
              {errors.password && (
                <p className="text-xs text-destructive">{errors.password.message}</p>
              )}
            </div>
            {state.error && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-sm text-destructive"
              >
                {state.error}
              </motion.p>
            )}
          </CardContent>
          <CardFooter className="flex flex-col gap-3 border-t-0 bg-transparent pt-2">
            <Button type="submit" className="w-full" disabled={isPending}>
              {isPending ? "Creando cuenta..." : "Crear cuenta"}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              ¿Ya tienes cuenta?{" "}
              <Link href="/login" className="text-primary underline-offset-4 hover:underline">
                Ingresa
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </motion.div>
  );
}
