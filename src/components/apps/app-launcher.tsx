"use client";

import Link from "next/link";
import { MotionConfig, motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { APPS } from "@/lib/apps";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function AppLauncher() {
  return (
    <MotionConfig reducedMotion="user">
      <ul className="grid gap-4 sm:grid-cols-2">
      {APPS.map((app, index) => {
        const Icon = app.icon;

        return (
          <motion.li
            key={app.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: index * 0.05 }}
          >
            <Link
              href={app.href}
              className="group block rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              aria-label={`Abrir ${app.name}`}
            >
              <Card className="h-full transition-shadow group-hover:shadow-md group-hover:ring-foreground/20">
                <CardHeader>
                  <div className="mb-2 flex items-center gap-3">
                    <span
                      className={cn(
                        "flex size-10 items-center justify-center rounded-lg",
                        app.accentClassName,
                      )}
                    >
                      <Icon className="size-5" />
                    </span>
                    <div className="min-w-0">
                      <CardTitle className="flex items-center gap-2">
                        {app.name}
                        {app.badge ? (
                          <Badge variant="secondary" className="uppercase">
                            {app.badge}
                          </Badge>
                        ) : null}
                      </CardTitle>
                      <p className="text-xs text-muted-foreground">{app.tagline}</p>
                    </div>
                  </div>
                  <CardDescription>{app.description}</CardDescription>
                  <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary">
                    Abrir
                    <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </CardHeader>
              </Card>
            </Link>
          </motion.li>
        );
      })}
      </ul>
    </MotionConfig>
  );
}
