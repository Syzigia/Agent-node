import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { createProject, getProjectsByUser } from "@/src/mastra/db";

export async function GET() {
  const userId = await getUserId();
  const rows = await getProjectsByUser(userId);
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const userId = await getUserId();
  const body = await req.json();

  if (!body.name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const project = await createProject({
    id: crypto.randomUUID(),
    userId,
    name: body.name.trim(),
  });
  return NextResponse.json(project, { status: 201 });
}
