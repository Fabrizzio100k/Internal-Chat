import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ messageId: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { messageId } = await params;

  const message = await prisma.message.findUnique({
    where: { id: messageId },
    include: {
      sender: { select: { id: true, username: true } },
      attachments: true,
    },
  });

  if (!message) {
    return NextResponse.json({ error: "Mensaje no encontrado" }, { status: 404 });
  }

  const participation = await prisma.conversationParticipant.findUnique({
    where: {
      conversationId_userId: { conversationId: message.conversationId, userId: session.userId },
    },
  });
  if (!participation) {
    return NextResponse.json({ error: "No tienes acceso a este mensaje" }, { status: 403 });
  }

  return NextResponse.json(message);
}
