import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import {
  getProject,
  getChat,
  updateChatTitle,
  deleteChat,
} from "@/src/mastra/db";

type Params = { params: Promise<{ projectId: string; chatId: string }> };

export async function GET(_req: Request, { params }: Params) {
  const userId = await getUserId();
  const { projectId, chatId } = await params;
  const project = await getProject(projectId);

  if (!project || project.userId !== userId) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const chat = await getChat(chatId);
  if (!chat || chat.projectId !== projectId) {
    return NextResponse.json({ error: "Chat not found" }, { status: 404 });
  }
  return NextResponse.json(chat);
}

export async function PATCH(req: Request, { params }: Params) {
  const userId = await getUserId();
  const { projectId, chatId } = await params;
  const project = await getProject(projectId);

  if (!project || project.userId !== userId) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const chat = await getChat(chatId);
  if (!chat || chat.projectId !== projectId) {
    return NextResponse.json({ error: "Chat not found" }, { status: 404 });
  }

  const body = await req.json();
  if (!body.title?.trim()) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  await updateChatTitle(chatId, body.title.trim());
  return NextResponse.json({ ...chat, title: body.title.trim() });
}

export async function DELETE(_req: Request, { params }: Params) {
  const userId = await getUserId();
  const { projectId, chatId } = await params;
  const project = await getProject(projectId);

  if (!project || project.userId !== userId) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const chat = await getChat(chatId);
  if (!chat || chat.projectId !== projectId) {
    return NextResponse.json({ error: "Chat not found" }, { status: 404 });
  }

  await deleteChat(chatId);
  return NextResponse.json({ deleted: true });
}
