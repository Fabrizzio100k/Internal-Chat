"use server";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { loadContacts } from "@/lib/conversations-server";
import type { ActionResult } from "@/lib/types/chat";
import { MESSAGE_INCLUDE } from "@/lib/messages-server";
import { publishToConversation, toRealtimeMessage } from "@/lib/realtime-server";
import type { GroupInfo } from "@/lib/types/groups";

const GROUP_NAME_MAX = 60;
const GROUP_MAX_MEMBERS = 50;

async function requireSession() {
  const session = await getSession();
  if (!session) throw new Error("No autenticado");
  return session;
}

/** Carga el grupo y verifica que `userId` es miembro. Devuelve también su rol. */
async function loadGroupFor(conversationId: string, userId: string) {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      isGroup: true,
      name: true,
      participants: {
        orderBy: { joinedAt: "asc" },
        select: {
          userId: true,
          role: true,
          joinedAt: true,
          user: { select: { id: true, username: true } },
        },
      },
    },
  });
  if (!conversation || !conversation.isGroup) return null;
  const me = conversation.participants.find((p) => p.userId === userId);
  if (!me) return null;
  return { conversation, myRole: me.role };
}

const NOT_FOUND: ActionResult = { success: false, error: "Grupo no encontrado" };
const NOT_ADMIN: ActionResult = {
  success: false,
  error: "Solo los administradores pueden hacer esto",
};

/** Información del grupo (miembros + roles). Se usa para refrescar en vivo. */
export async function getGroupInfoAction(conversationId: string): Promise<GroupInfo | null> {
  const session = await requireSession();
  const group = await loadGroupFor(conversationId, session.userId);
  if (!group) return null;
  return {
    name: group.conversation.name ?? "Grupo",
    myRole: group.myRole,
    members: group.conversation.participants.map((p) => ({
      id: p.user.id,
      username: p.user.username,
      role: p.role,
    })),
  };
}

/** Personas que el usuario puede añadir a este grupo (contactos que aún no están). */
export async function listAddableContactsAction(conversationId: string) {
  const session = await requireSession();
  const group = await loadGroupFor(conversationId, session.userId);
  if (!group) return [];
  const inGroup = new Set(group.conversation.participants.map((p) => p.userId));
  return (await loadContacts(session.userId)).filter((c) => !inGroup.has(c.id));
}

export async function addGroupMembersAction(
  conversationId: string,
  userIds: string[],
): Promise<ActionResult> {
  const session = await requireSession();
  const group = await loadGroupFor(conversationId, session.userId);
  if (!group) return NOT_FOUND;
  if (group.myRole !== "ADMIN") return NOT_ADMIN;

  const inGroup = new Set(group.conversation.participants.map((p) => p.userId));
  const ids = [...new Set(userIds)].filter((id) => !inGroup.has(id));
  if (ids.length === 0) return { success: false, error: "Elige al menos un participante" };
  if (inGroup.size + ids.length > GROUP_MAX_MEMBERS) {
    return { success: false, error: `Máximo ${GROUP_MAX_MEMBERS} participantes` };
  }

  const contacts = await loadContacts(session.userId);
  const byId = new Map(contacts.map((c) => [c.id, c.username]));
  if (ids.some((id) => !byId.has(id))) {
    return { success: false, error: "Solo puedes añadir a personas con las que ya chateas" };
  }

  const [, addedMessage] = await prisma.$transaction([
    prisma.conversationParticipant.createMany({
      data: ids.map((userId) => ({ conversationId, userId })),
      skipDuplicates: true,
    }),
    prisma.message.create({
      data: {
        conversationId,
        senderId: session.userId,
        content: `${session.username} añadió a ${ids.map((id) => byId.get(id)).join(", ")}`,
        kind: "member_added",
        targetUserIds: ids,
      },
      include: MESSAGE_INCLUDE,
    }),
  ]);
  publishToConversation(conversationId, {
    type: "message",
    message: toRealtimeMessage(addedMessage),
  });
  return { success: true };
}

export async function removeGroupMemberAction(
  conversationId: string,
  userId: string,
): Promise<ActionResult> {
  const session = await requireSession();
  const group = await loadGroupFor(conversationId, session.userId);
  if (!group) return NOT_FOUND;
  if (group.myRole !== "ADMIN") return NOT_ADMIN;
  if (userId === session.userId) return { success: false, error: "Usa «Salir del grupo»" };

  const target = group.conversation.participants.find((p) => p.userId === userId);
  if (!target) return { success: false, error: "Esa persona ya no está en el grupo" };

  // El mensaje se crea ANTES de borrar la fila: así el evento de Realtime llega
  // con targetUserIds y el expulsado sabe que debe quitar el chat de su lista.
  const [removedMessage] = await prisma.$transaction([
    prisma.message.create({
      data: {
        conversationId,
        senderId: session.userId,
        content: `${session.username} eliminó a ${target.user.username}`,
        kind: "member_removed",
        targetUserIds: [userId],
      },
      include: MESSAGE_INCLUDE,
    }),
    prisma.conversationParticipant.delete({
      where: { conversationId_userId: { conversationId, userId } },
    }),
  ]);
  // El expulsado ya no figura como participante: se le incluye explícitamente
  // para que su sidebar reciba el evento y quite el chat.
  publishToConversation(
    conversationId,
    { type: "message", message: toRealtimeMessage(removedMessage) },
    [userId],
  );
  return { success: true };
}

export async function leaveGroupAction(conversationId: string): Promise<ActionResult> {
  const session = await requireSession();
  const group = await loadGroupFor(conversationId, session.userId);
  if (!group) return NOT_FOUND;

  const others = group.conversation.participants.filter((p) => p.userId !== session.userId);
  // Si era el único admin, el miembro más antiguo pasa a ser admin (como WhatsApp).
  const needsNewAdmin =
    group.myRole === "ADMIN" && others.length > 0 && !others.some((p) => p.role === "ADMIN");

  const [leftMessage] = await prisma.$transaction([
    prisma.message.create({
      data: {
        conversationId,
        senderId: session.userId,
        content: `${session.username} salió del grupo`,
        kind: "member_left",
        targetUserIds: [session.userId],
      },
      include: MESSAGE_INCLUDE,
    }),
    prisma.conversationParticipant.delete({
      where: { conversationId_userId: { conversationId, userId: session.userId } },
    }),
    ...(needsNewAdmin
      ? [
          prisma.conversationParticipant.update({
            where: { conversationId_userId: { conversationId, userId: others[0].userId } },
            data: { role: "ADMIN" },
          }),
        ]
      : []),
  ]);
  publishToConversation(
    conversationId,
    { type: "message", message: toRealtimeMessage(leftMessage) },
    [session.userId],
  );
  return { success: true };
}

export async function renameGroupAction(
  conversationId: string,
  name: string,
): Promise<ActionResult> {
  const session = await requireSession();
  const group = await loadGroupFor(conversationId, session.userId);
  if (!group) return NOT_FOUND;
  if (group.myRole !== "ADMIN") return NOT_ADMIN;

  const trimmed = name.trim();
  if (!trimmed) return { success: false, error: "El grupo necesita un nombre" };
  if (trimmed.length > GROUP_NAME_MAX) {
    return { success: false, error: `El nombre no puede superar ${GROUP_NAME_MAX} caracteres` };
  }
  if (trimmed === group.conversation.name) return { success: true };

  const [, renamedMessage] = await prisma.$transaction([
    prisma.conversation.update({ where: { id: conversationId }, data: { name: trimmed } }),
    prisma.message.create({
      data: {
        conversationId,
        senderId: session.userId,
        content: `${session.username} cambió el nombre del grupo a "${trimmed}"`,
        kind: "group_renamed",
        targetUserIds: [],
      },
      include: MESSAGE_INCLUDE,
    }),
  ]);
  publishToConversation(conversationId, {
    type: "message",
    message: toRealtimeMessage(renamedMessage),
  });
  return { success: true };
}

export async function setGroupAdminAction(
  conversationId: string,
  userId: string,
  makeAdmin: boolean,
): Promise<ActionResult> {
  const session = await requireSession();
  const group = await loadGroupFor(conversationId, session.userId);
  if (!group) return NOT_FOUND;
  if (group.myRole !== "ADMIN") return NOT_ADMIN;

  const target = group.conversation.participants.find((p) => p.userId === userId);
  if (!target) return { success: false, error: "Esa persona ya no está en el grupo" };

  if (!makeAdmin) {
    const admins = group.conversation.participants.filter((p) => p.role === "ADMIN");
    if (admins.length <= 1 && target.role === "ADMIN") {
      return { success: false, error: "El grupo necesita al menos un administrador" };
    }
  }

  const [, roleMessage] = await prisma.$transaction([
    prisma.conversationParticipant.update({
      where: { conversationId_userId: { conversationId, userId } },
      data: { role: makeAdmin ? "ADMIN" : "MEMBER" },
    }),
    prisma.message.create({
      data: {
        conversationId,
        senderId: session.userId,
        content: makeAdmin
          ? `${session.username} hizo administrador a ${target.user.username}`
          : `${session.username} quitó el rol de administrador a ${target.user.username}`,
        kind: "member_role",
        targetUserIds: [],
      },
      include: MESSAGE_INCLUDE,
    }),
  ]);
  publishToConversation(conversationId, {
    type: "message",
    message: toRealtimeMessage(roleMessage),
  });
  return { success: true };
}
