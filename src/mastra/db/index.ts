import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq, desc, sql } from "drizzle-orm";
import { projects, chats } from "./schema";

const databaseUrl = process.env.DATABASE_URL;
const databaseToken = process.env.DATABASE_TOKEN;

if (!databaseUrl) {
  throw new Error("DATABASE_URL environment variable is required");
}

const client = createClient({
  url: databaseUrl,
  authToken: databaseToken,
});

export const db = drizzle(client);

// --- Projects ---

export async function createProject(params: {
  id: string;
  userId: string;
  name: string;
}) {
  const s3Prefix = `users/${params.userId}/${params.id}`;
  const [project] = await db
    .insert(projects)
    .values({
      id: params.id,
      userId: params.userId,
      name: params.name,
      s3Prefix,
    })
    .returning();
  return project;
}

export async function getProjectsByUser(userId: string) {
  return db
    .select()
    .from(projects)
    .where(eq(projects.userId, userId))
    .orderBy(desc(projects.createdAt));
}

export async function getProject(projectId: string) {
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId));
  return project ?? null;
}

export async function deleteProject(projectId: string) {
  await db.delete(projects).where(eq(projects.id, projectId));
}

// --- Chats ---

export async function createChat(params: {
  id: string;
  projectId: string;
  title: string;
  threadId: string;
}) {
  const [chat] = await db
    .insert(chats)
    .values({
      id: params.id,
      projectId: params.projectId,
      title: params.title,
      threadId: params.threadId,
    })
    .returning();
  return chat;
}

export async function getChatsByProject(projectId: string) {
  return db
    .select()
    .from(chats)
    .where(eq(chats.projectId, projectId))
    .orderBy(desc(chats.createdAt));
}

export async function getChat(chatId: string) {
  const [chat] = await db
    .select()
    .from(chats)
    .where(eq(chats.id, chatId));
  return chat ?? null;
}

export async function updateChatTitle(chatId: string, title: string) {
  await db
    .update(chats)
    .set({ title, updatedAt: sql`datetime('now')` })
    .where(eq(chats.id, chatId));
}

export async function deleteChat(chatId: string) {
  await db.delete(chats).where(eq(chats.id, chatId));
}
