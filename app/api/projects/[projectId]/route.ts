import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { getProject, deleteProject } from "@/src/mastra/db";

type Params = { params: Promise<{ projectId: string }> };

export async function GET(_req: Request, { params }: Params) {
  const userId = await getUserId();
  const { projectId } = await params;
  const project = await getProject(projectId);

  if (!project || project.userId !== userId) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  return NextResponse.json(project);
}

export async function DELETE(_req: Request, { params }: Params) {
  const userId = await getUserId();
  const { projectId } = await params;
  const project = await getProject(projectId);

  if (!project || project.userId !== userId) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  await deleteProject(projectId);
  return NextResponse.json({ deleted: true });
}
