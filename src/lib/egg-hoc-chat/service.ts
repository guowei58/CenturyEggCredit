import {
  ConversationMemberRole,
  ConversationType,
  EggHocMessageType,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { makeDirectPairKey } from "@/lib/egg-hoc-chat/directPairKey";
import { assertUserStorageAllowsNetDelta } from "@/lib/user-storage-quota";
import {
  parseUserPreferencesPayload,
  serializeUserPreferencesPayload,
  USER_PREFERENCES_VERSION,
} from "@/lib/user-preferences-types";

const userPublicSelect = {
  id: true,
  name: true,
  email: true,
  image: true,
  preferences: { select: { payload: true } },
} as const;

function userChatIdFromPreferencesPayload(payload: string | null | undefined): string | null {
  try {
    const prefs = parseUserPreferencesPayload(payload ?? null);
    const v = prefs.profile?.chatDisplayId?.trim();
    return v ? v : null;
  } catch {
    return null;
  }
}

function defaultChatIdFromEmail(email: string | null | undefined): string | null {
  const e = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!e || !e.includes("@")) return null;
  const rawLocal = (e.split("@")[0] ?? "").trim();
  if (!rawLocal) return null;
  let s = rawLocal
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[^a-z0-9]+/g, "")
    .replace(/[^a-z0-9]+$/g, "");
  if (!s) return null;
  if (s.length > 24) s = s.slice(0, 24).replace(/[^a-z0-9]+$/g, "");
  if (s.length < 3) return null;
  return s;
}

/**
 * Chat-visible handle: Egg-Hoc `profile.chatDisplayId` from preferences, else slug from email.
 * Never uses `User.name` (often a stale OAuth / registration username like guowei58).
 */
function displayChatIdFromUserRow(u: {
  email: string | null;
  preferences?: { payload: string } | null;
} | null | undefined): string | null {
  if (!u) return null;
  const prefId = userChatIdFromPreferencesPayload(u.preferences?.payload);
  if (prefId) return prefId;
  return defaultChatIdFromEmail(u.email);
}

/** Last-resort label when prefs + email rules yield nothing — still avoids `User.name`. */
function fallbackChatDisplayId(userId: string): string {
  const a = userId.replace(/[^a-z0-9]/gi, "");
  const tail = (a.length >= 6 ? a.slice(-8) : userId.slice(0, 8)) || "user";
  return `pal-${tail}`;
}

function publicUserRowToPublicUser(u: {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  preferences?: { payload: string } | null;
}): { id: string; name: string | null; email: string | null; image: string | null; chatDisplayId: string } {
  const chatDisplayId = displayChatIdFromUserRow(u) ?? fallbackChatDisplayId(u.id);
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    image: u.image,
    chatDisplayId,
  };
}

function dedupeConversationMembers<
  T extends {
    userId: string;
    role: ConversationMemberRole;
    joinedAt: Date;
    user: { id: string; name: string | null; email: string | null; image: string | null; preferences?: { payload: string } | null };
  },
>(members: T[]): T[] {
  const rank = (r: ConversationMemberRole) => (r === ConversationMemberRole.ADMIN ? 2 : 1);
  const best = new Map<string, T>();
  for (const m of members) {
    const cur = best.get(m.userId);
    if (!cur || rank(m.role) > rank(cur.role)) best.set(m.userId, m);
  }
  return Array.from(best.values()).sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime());
}

/** Single app-wide general channel; `Conversation.lobbyKey` matches this value. */
export const GLOBAL_LOBBY_KEY = "global" as const;

const LOBBY_TITLE = "Lobby";

const OREO_LOBBY_BOT_EMAIL = "oreo-lobby-bot@noreply.centuryegg.internal";

/** First Lobby line for each new member (`visibleOnlyToUserId` so others do not get unread). */
const OREO_LOBBY_WELCOME_MESSAGE = "OREO says hi - woof woof";

/** Rows the viewer may see in previews, threads, and unread (null = everyone). */
function messageVisibleToViewerWhere(viewerUserId: string) {
  return {
    OR: [{ visibleOnlyToUserId: null }, { visibleOnlyToUserId: viewerUserId }],
  };
}

async function getOrCreateOreoLobbyBotUserId(): Promise<string> {
  const payload = serializeUserPreferencesPayload({
    v: USER_PREFERENCES_VERSION,
    profile: { chatDisplayId: "OREO" },
  });
  const row = await prisma.user.upsert({
    where: { email: OREO_LOBBY_BOT_EMAIL },
    create: {
      email: OREO_LOBBY_BOT_EMAIL,
      name: "OREO",
      preferences: { create: { payload } },
    },
    update: {},
    select: { id: true },
  });
  return row.id;
}

async function postOreoLobbyWelcomeMessage(conversationId: string, recipientUserId: string): Promise<void> {
  const botId = await getOrCreateOreoLobbyBotUserId();
  await prisma.$transaction(async (tx) => {
    const m = await tx.eggHocMessage.create({
      data: {
        conversationId,
        senderUserId: botId,
        visibleOnlyToUserId: recipientUserId,
        body: OREO_LOBBY_WELCOME_MESSAGE,
        messageType: EggHocMessageType.TEXT,
      },
    });
    await tx.conversation.update({
      where: { id: conversationId },
      data: { lastMessageId: m.id },
    });
  });
}

function isPrismaUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "P2002";
}

/**
 * Ensures the global Lobby row exists and the user is a member (lazy join for every account).
 * New members receive a targeted Lobby welcome from OREO (unread for them only).
 */
export async function ensureUserInGlobalLobby(userId: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    let lobby = await prisma.conversation.findUnique({
      where: { lobbyKey: GLOBAL_LOBBY_KEY },
      select: { id: true },
    });

    if (!lobby) {
      let createdLobbyThisAttempt = false;
      try {
        await prisma.conversation.create({
          data: {
            type: ConversationType.GROUP,
            name: LOBBY_TITLE,
            lobbyKey: GLOBAL_LOBBY_KEY,
            createdByUserId: userId,
            members: {
              create: { userId, role: ConversationMemberRole.MEMBER },
            },
          },
        });
        createdLobbyThisAttempt = true;
      } catch (e) {
        if (!isPrismaUniqueViolation(e)) throw e;
      }
      lobby = await prisma.conversation.findUnique({
        where: { lobbyKey: GLOBAL_LOBBY_KEY },
        select: { id: true },
      });
      if (lobby && createdLobbyThisAttempt) {
        await postOreoLobbyWelcomeMessage(lobby.id, userId);
        return;
      }
    }

    if (!lobby) continue;

    const alreadyMember = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId: lobby.id, userId } },
      select: { id: true },
    });
    if (alreadyMember) return;

    try {
      await prisma.conversationMember.create({
        data: { conversationId: lobby.id, userId, role: ConversationMemberRole.MEMBER },
      });
      await postOreoLobbyWelcomeMessage(lobby.id, userId);
    } catch (e) {
      if (!isPrismaUniqueViolation(e)) throw e;
    }
    return;
  }
}

export async function assertMember(conversationId: string, userId: string) {
  const m = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
    select: { id: true, role: true, joinedAt: true },
  });
  return m;
}

export async function countUnreadForMember(
  conversationId: string,
  userId: string,
  lastReadMessageId: string | null,
  memberJoinedAt: Date
): Promise<number> {
  const base = {
    conversationId,
    deletedAt: null,
    senderUserId: { not: userId },
    messageType: EggHocMessageType.TEXT,
    createdAt: { gte: memberJoinedAt },
    ...messageVisibleToViewerWhere(userId),
  } as const;

  if (!lastReadMessageId) {
    return prisma.eggHocMessage.count({ where: base });
  }

  const anchor = await prisma.eggHocMessage.findUnique({
    where: { id: lastReadMessageId },
    select: { createdAt: true },
  });
  if (!anchor || anchor.createdAt < memberJoinedAt) {
    return prisma.eggHocMessage.count({ where: base });
  }

  return prisma.eggHocMessage.count({
    where: {
      ...base,
      createdAt: { gt: anchor.createdAt },
    },
  });
}

function titleForConversation(
  type: ConversationType,
  name: string | null,
  members: Array<{ userId: string; user: { id: string; name: string | null; email: string | null; preferences?: { payload: string } | null } }>,
  viewerUserId: string,
  lobbyKey: string | null
): string {
  if (lobbyKey) return LOBBY_TITLE;
  if (type === ConversationType.GROUP) {
    return name?.trim() || "Group chat";
  }
  const other = members.find((m) => m.userId !== viewerUserId)?.user;
  if (!other) return "Direct message";
  return displayChatIdFromUserRow(other) ?? fallbackChatDisplayId(other.id);
}

export async function listUserConversations(userId: string) {
  await ensureUserInGlobalLobby(userId);

  const memberships = await prisma.conversationMember.findMany({
    where: { userId },
    orderBy: { conversation: { updatedAt: "desc" } },
    include: {
      conversation: {
        include: {
          members: {
            include: { user: { select: userPublicSelect } },
          },
        },
      },
    },
  });

  const withUnread = await Promise.all(
    memberships.map(async (row) => {
      const c = row.conversation;
      const joinedAt = row.joinedAt;
      const unread = await countUnreadForMember(c.id, userId, row.lastReadMessageId, joinedAt);

      const lastVisible = await prisma.eggHocMessage.findFirst({
        where: {
          conversationId: c.id,
          deletedAt: null,
          createdAt: { gte: joinedAt },
          ...messageVisibleToViewerWhere(userId),
        },
        orderBy: { createdAt: "desc" },
        include: { sender: { select: userPublicSelect } },
      });

      const preview = lastVisible
        ? lastVisible.body.slice(0, 140) + (lastVisible.body.length > 140 ? "…" : "")
        : "";
      const isLobby = c.lobbyKey === GLOBAL_LOBBY_KEY;
      const senderRow = lastVisible?.sender;
      const lastSenderLabel = senderRow
        ? displayChatIdFromUserRow(senderRow) ?? fallbackChatDisplayId(senderRow.id)
        : null;
      return {
        id: c.id,
        type: c.type,
        name: c.name,
        isLobby,
        updatedAt: c.updatedAt.toISOString(),
        title: titleForConversation(c.type, c.name, c.members, userId, c.lobbyKey),
        lastMessageAt: lastVisible?.createdAt.toISOString() ?? joinedAt.toISOString(),
        lastMessagePreview: preview,
        unreadCount: unread,
        lastMessageSenderName: lastSenderLabel,
      };
    })
  );

  withUnread.sort((a, b) => {
    if (a.isLobby !== b.isLobby) return a.isLobby ? -1 : 1;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });

  return withUnread;
}

export async function getConversationDetail(conversationId: string, userId: string) {
  const lobbyRow = await prisma.conversation.findFirst({
    where: { id: conversationId, lobbyKey: GLOBAL_LOBBY_KEY },
    select: { id: true },
  });
  if (lobbyRow) await ensureUserInGlobalLobby(userId);

  const member = await assertMember(conversationId, userId);
  if (!member) return { ok: false as const, error: "Not a member of this conversation" };

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: {
      members: {
        include: { user: { select: userPublicSelect } },
        orderBy: { joinedAt: "asc" },
      },
    },
  });
  if (!conversation) return { ok: false as const, error: "Conversation not found" };

  const isLobby = conversation.lobbyKey === GLOBAL_LOBBY_KEY;
  const uniqueMembers = dedupeConversationMembers(conversation.members);

  return {
    ok: true as const,
    conversation: {
      id: conversation.id,
      type: conversation.type,
      name: conversation.name,
      isLobby,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
      title: titleForConversation(
        conversation.type,
        conversation.name,
        uniqueMembers,
        userId,
        conversation.lobbyKey
      ),
      myRole: member.role,
      members: uniqueMembers.map((m) => ({
        userId: m.userId,
        role: m.role,
        joinedAt: m.joinedAt.toISOString(),
        user: publicUserRowToPublicUser(m.user),
      })),
    },
  };
}

export async function createDirectConversation(currentUserId: string, targetUserId: string) {
  const target = targetUserId.trim();
  if (!target || target === currentUserId) {
    return { ok: false as const, error: "Invalid target user" };
  }

  const targetUser = await prisma.user.findUnique({ where: { id: target }, select: { id: true } });
  if (!targetUser) return { ok: false as const, error: "User not found" };

  const directPairKey = makeDirectPairKey(currentUserId, target);

  const existing = await prisma.conversation.findUnique({
    where: { directPairKey },
    select: { id: true },
  });
  if (existing) {
    return { ok: true as const, conversationId: existing.id, created: false };
  }

  const conv = await prisma.$transaction(async (tx) => {
    const c = await tx.conversation.create({
      data: {
        type: ConversationType.DIRECT,
        directPairKey,
        createdByUserId: currentUserId,
        members: {
          create: [
            { userId: currentUserId, role: ConversationMemberRole.MEMBER },
            { userId: target, role: ConversationMemberRole.MEMBER },
          ],
        },
      },
    });
    return c;
  });

  return { ok: true as const, conversationId: conv.id, created: true };
}

export async function createGroupConversation(
  currentUserId: string,
  name: string,
  memberUserIds: string[]
) {
  const title = name.trim();
  if (!title) return { ok: false as const, error: "Group name is required" };

  const ids = Array.from(
    new Set([currentUserId, ...memberUserIds.map((x) => x.trim()).filter(Boolean)])
  );
  if (ids.length < 2) {
    return { ok: false as const, error: "Add at least one other member" };
  }

  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  if (users.length !== ids.length) {
    return { ok: false as const, error: "One or more users were not found" };
  }

  const conv = await prisma.conversation.create({
    data: {
      type: ConversationType.GROUP,
      name: title,
      createdByUserId: currentUserId,
      members: {
        create: ids.map((uid) => ({
          userId: uid,
          role: uid === currentUserId ? ConversationMemberRole.ADMIN : ConversationMemberRole.MEMBER,
        })),
      },
    },
  });

  return { ok: true as const, conversationId: conv.id };
}

export async function getConversationMessages(
  conversationId: string,
  userId: string,
  opts: { beforeMessageId?: string | null; take?: number }
) {
  const member = await assertMember(conversationId, userId);
  if (!member) return { ok: false as const, error: "Not a member of this conversation" };

  const take = Math.min(Math.max(opts.take ?? 40, 1), 100);
  const joinedAt = member.joinedAt;

  let cursorDate: Date | null = null;
  if (opts.beforeMessageId) {
    const cur = await prisma.eggHocMessage.findFirst({
      where: { id: opts.beforeMessageId, conversationId },
      select: { createdAt: true },
    });
    if (cur) cursorDate = cur.createdAt;
  }

  const messages = await prisma.eggHocMessage.findMany({
    where: {
      conversationId,
      createdAt: {
        gte: joinedAt,
        ...(cursorDate ? { lt: cursorDate } : {}),
      },
      ...messageVisibleToViewerWhere(userId),
    },
    orderBy: { createdAt: "desc" },
    take,
    include: {
      sender: { select: userPublicSelect },
    },
  });

  const chronological = [...messages].reverse();
  const nextCursor = chronological.length > 0 ? chronological[0].id : null;

  /** Load parents by id so every reply carries the same quoted preview for all members (explicit `replyToMessageId` resolution, independent of the main page query shape). */
  const replyParentIds = [
    ...new Set(
      messages
        .map((m) => m.replyToMessageId)
        .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
        .map((id) => id.trim())
    ),
  ];
  const replyParents =
    replyParentIds.length > 0
      ? await prisma.eggHocMessage.findMany({
          where: {
            conversationId,
            id: { in: replyParentIds },
            ...messageVisibleToViewerWhere(userId),
          },
          select: {
            id: true,
            body: true,
            deletedAt: true,
            sender: { select: userPublicSelect },
          },
        })
      : [];
  const replyToWireByParentId = new Map(
    replyParents.map((p) => [
      p.id,
      {
        id: p.id,
        body: p.deletedAt ? "" : p.body,
        deletedAt: p.deletedAt?.toISOString() ?? null,
        sender: publicUserRowToPublicUser(p.sender),
      },
    ])
  );

  return {
    ok: true as const,
    messages: chronological.map((m) => {
      const rid = typeof m.replyToMessageId === "string" ? m.replyToMessageId.trim() : "";
      const replyTo = rid && replyToWireByParentId.has(rid) ? replyToWireByParentId.get(rid)! : null;
      return {
        id: m.id,
        conversationId: m.conversationId,
        senderUserId: m.senderUserId,
        body: m.body,
        messageType: m.messageType,
        replyToMessageId: m.replyToMessageId,
        editedAt: m.editedAt?.toISOString() ?? null,
        deletedAt: m.deletedAt?.toISOString() ?? null,
        createdAt: m.createdAt.toISOString(),
        sender: publicUserRowToPublicUser(m.sender),
        replyTo,
      };
    }),
    hasMore: messages.length === take,
    nextCursor,
  };
}

export async function sendMessage(
  conversationId: string,
  userId: string,
  body: string,
  replyToMessageId?: string | null
) {
  const text = body.trim();
  if (!text) return { ok: false as const, error: "Message cannot be empty" };
  if (text.length > 20_000) return { ok: false as const, error: "Message too long" };

  const member = await assertMember(conversationId, userId);
  if (!member) return { ok: false as const, error: "Not a member of this conversation" };

  const byteLen = Buffer.byteLength(text, "utf8");
  const quota = await assertUserStorageAllowsNetDelta(userId, byteLen);
  if (!quota.ok) return { ok: false as const, error: quota.error };

  let replyId: string | null = null;
  const rawReply = typeof replyToMessageId === "string" ? replyToMessageId.trim() : "";
  if (rawReply) {
    const parent = await prisma.eggHocMessage.findFirst({
      where: {
        id: rawReply,
        conversationId,
        deletedAt: null,
        ...messageVisibleToViewerWhere(userId),
      },
      select: { id: true },
    });
    if (!parent) return { ok: false as const, error: "That message was not found in this chat" };
    replyId = parent.id;
  }

  const msg = await prisma.$transaction(async (tx) => {
    const m = await tx.eggHocMessage.create({
      data: {
        conversationId,
        senderUserId: userId,
        body: text,
        messageType: EggHocMessageType.TEXT,
        replyToMessageId: replyId,
      },
      include: {
        sender: { select: userPublicSelect },
        replyTo: {
          select: {
            id: true,
            body: true,
            deletedAt: true,
            sender: { select: userPublicSelect },
          },
        },
      },
    });
    await tx.conversation.update({
      where: { id: conversationId },
      data: { lastMessageId: m.id },
    });
    return m;
  });

  return {
    ok: true as const,
    message: {
      id: msg.id,
      conversationId: msg.conversationId,
      senderUserId: msg.senderUserId,
      body: msg.body,
      messageType: msg.messageType,
      replyToMessageId: msg.replyToMessageId,
      editedAt: null,
      deletedAt: null,
      createdAt: msg.createdAt.toISOString(),
      sender: publicUserRowToPublicUser(msg.sender),
      replyTo: msg.replyTo
        ? {
            id: msg.replyTo.id,
            body: msg.replyTo.deletedAt ? "" : msg.replyTo.body,
            deletedAt: msg.replyTo.deletedAt?.toISOString() ?? null,
            sender: publicUserRowToPublicUser(msg.replyTo.sender),
          }
        : null,
    },
  };
}

export async function markConversationRead(conversationId: string, userId: string, messageId?: string | null) {
  const member = await assertMember(conversationId, userId);
  if (!member) return { ok: false as const, error: "Not a member of this conversation" };

  const joinedAt = member.joinedAt;

  let targetId = messageId?.trim() || null;
  if (!targetId) {
    const last = await prisma.eggHocMessage.findFirst({
      where: {
        conversationId,
        deletedAt: null,
        createdAt: { gte: joinedAt },
        ...messageVisibleToViewerWhere(userId),
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    targetId = last?.id ?? null;
  }

  if (targetId) {
    const exists = await prisma.eggHocMessage.findFirst({
      where: {
        id: targetId,
        conversationId,
        createdAt: { gte: joinedAt },
        ...messageVisibleToViewerWhere(userId),
      },
      select: { id: true },
    });
    if (!exists) return { ok: false as const, error: "Message not in this conversation" };
  }

  await prisma.conversationMember.update({
    where: { conversationId_userId: { conversationId, userId } },
    data: {
      lastReadMessageId: targetId,
      lastReadAt: new Date(),
    },
  });

  return { ok: true as const };
}

export async function renameGroupConversation(conversationId: string, userId: string, name: string) {
  const next = name.trim();
  if (!next) return { ok: false as const, error: "Name required" };

  const member = await assertMember(conversationId, userId);
  if (!member) return { ok: false as const, error: "Not a member" };
  if (member.role !== ConversationMemberRole.ADMIN) {
    return { ok: false as const, error: "Only admins can rename the group" };
  }

  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { type: true, lobbyKey: true },
  });
  if (!conv || conv.type !== ConversationType.GROUP) {
    return { ok: false as const, error: "Not a group conversation" };
  }
  if (conv.lobbyKey) {
    return { ok: false as const, error: "The Lobby cannot be renamed" };
  }

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { name: next },
  });

  return { ok: true as const };
}

async function countAdmins(conversationId: string) {
  return prisma.conversationMember.count({
    where: { conversationId, role: ConversationMemberRole.ADMIN },
  });
}

export async function addGroupMembers(conversationId: string, actorUserId: string, userIds: string[]) {
  const member = await assertMember(conversationId, actorUserId);
  if (!member) return { ok: false as const, error: "Not a member" };
  if (member.role !== ConversationMemberRole.ADMIN) {
    return { ok: false as const, error: "Only admins can add members" };
  }

  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { type: true, lobbyKey: true },
  });
  if (!conv || conv.type !== ConversationType.GROUP) {
    return { ok: false as const, error: "Not a group conversation" };
  }
  if (conv.lobbyKey) {
    return { ok: false as const, error: "Members join the Lobby automatically" };
  }

  const unique = Array.from(new Set(userIds.map((x) => x.trim()).filter(Boolean)));
  if (unique.length === 0) return { ok: false as const, error: "No users to add" };

  const existing = await prisma.conversationMember.findMany({
    where: { conversationId, userId: { in: unique } },
    select: { userId: true },
  });
  const existingSet = new Set(existing.map((e) => e.userId));
  const toAdd = unique.filter((id) => !existingSet.has(id));
  if (toAdd.length === 0) return { ok: true as const, added: 0 };

  const users = await prisma.user.findMany({ where: { id: { in: toAdd } }, select: { id: true } });
  if (users.length !== toAdd.length) {
    return { ok: false as const, error: "One or more users were not found" };
  }

  await prisma.conversationMember.createMany({
    data: toAdd.map((uid) => ({
      conversationId,
      userId: uid,
      role: ConversationMemberRole.MEMBER,
    })),
  });

  return { ok: true as const, added: toAdd.length };
}

export async function removeGroupMember(conversationId: string, actorUserId: string, targetUserId: string) {
  const actor = await assertMember(conversationId, actorUserId);
  if (!actor) return { ok: false as const, error: "Not a member" };

  const target = await assertMember(conversationId, targetUserId);
  if (!target) return { ok: false as const, error: "User is not in this conversation" };

  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { type: true, lobbyKey: true },
  });
  if (!conv || conv.type !== ConversationType.GROUP) {
    return { ok: false as const, error: "Not a group conversation" };
  }
  if (conv.lobbyKey) {
    return {
      ok: false as const,
      error: "The Lobby includes everyone; membership is managed automatically",
    };
  }

  const isSelf = actorUserId === targetUserId;
  const actorIsAdmin = actor.role === ConversationMemberRole.ADMIN;

  if (!isSelf && !actorIsAdmin) {
    return { ok: false as const, error: "Only admins can remove other members" };
  }

  if (target.role === ConversationMemberRole.ADMIN) {
    const admins = await countAdmins(conversationId);
    if (admins <= 1 && targetUserId === actorUserId) {
      return {
        ok: false as const,
        error: "You are the only admin. Promote another admin before leaving (contact support if needed).",
      };
    }
    if (admins <= 1 && targetUserId !== actorUserId) {
      return { ok: false as const, error: "Cannot remove the only admin" };
    }
  }

  await prisma.conversationMember.delete({
    where: { conversationId_userId: { conversationId, userId: targetUserId } },
  });

  return { ok: true as const };
}

export async function editMessage(messageId: string, userId: string, body: string) {
  const text = body.trim();
  if (!text) return { ok: false as const, error: "Message cannot be empty" };

  const msg = await prisma.eggHocMessage.findUnique({
    where: { id: messageId },
    select: { id: true, senderUserId: true, deletedAt: true, body: true },
  });
  if (!msg || msg.deletedAt) return { ok: false as const, error: "Message not found" };
  if (msg.senderUserId !== userId) return { ok: false as const, error: "You can only edit your own messages" };

  const quota = await assertUserStorageAllowsNetDelta(
    userId,
    Buffer.byteLength(text, "utf8") - Buffer.byteLength(msg.body, "utf8"),
  );
  if (!quota.ok) return { ok: false as const, error: quota.error };

  await prisma.eggHocMessage.update({
    where: { id: messageId },
    data: { body: text, editedAt: new Date() },
  });

  return { ok: true as const };
}

export async function softDeleteMessage(messageId: string, userId: string) {
  const msg = await prisma.eggHocMessage.findUnique({
    where: { id: messageId },
    select: { id: true, senderUserId: true, deletedAt: true, conversationId: true },
  });
  if (!msg || msg.deletedAt) return { ok: false as const, error: "Message not found" };
  if (msg.senderUserId !== userId) return { ok: false as const, error: "You can only delete your own messages" };

  await prisma.eggHocMessage.update({
    where: { id: messageId },
    data: { deletedAt: new Date(), body: "" },
  });

  const conv = await prisma.conversation.findUnique({
    where: { id: msg.conversationId },
    select: { lastMessageId: true },
  });
  if (conv?.lastMessageId === messageId) {
    const prev = await prisma.eggHocMessage.findFirst({
      where: { conversationId: msg.conversationId, deletedAt: null, id: { not: messageId } },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    await prisma.conversation.update({
      where: { id: msg.conversationId },
      data: { lastMessageId: prev?.id ?? null },
    });
  }

  return { ok: true as const };
}

export async function searchUsers(query: string, excludeUserId: string, take = 20) {
  const q = query.trim();
  const lim = Math.min(take, 50);

  if (q.length < 2) {
    const users = await prisma.user.findMany({
      where: { id: { not: excludeUserId } },
      select: userPublicSelect,
      take: lim,
      orderBy: [{ name: "asc" }, { email: "asc" }],
    });
    return users.map(publicUserRowToPublicUser);
  }

  const users = await prisma.user.findMany({
    where: {
      id: { not: excludeUserId },
      OR: [
        { email: { contains: q, mode: "insensitive" } },
        { name: { contains: q, mode: "insensitive" } },
      ],
    },
    select: userPublicSelect,
    take: lim,
    orderBy: { email: "asc" },
  });
  return users.map(publicUserRowToPublicUser);
}
