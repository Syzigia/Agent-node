import { registerApiRoute } from "@mastra/core/server";
import { HTTPException } from "hono/http-exception";
import {
  createProject,
  getProjectsByUser,
  getProject,
  deleteProject,
  createChat,
  getChatsByProject,
  getChat,
  updateChatTitle,
  deleteChat,
} from "../db";

function getUserId(c: any): string {
  const user = c.get("requestContext")?.get("user");
  const userId = user?.sub;
  if (!userId) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }
  return userId;
}

function generateId(): string {
  return crypto.randomUUID();
}

// --- Projects ---

const listProjects = registerApiRoute("/projects", {
  method: "GET",
  handler: async (c) => {
    const userId = getUserId(c);
    const rows = await getProjectsByUser(userId);
    return c.json(rows);
  },
});

const createProjectRoute = registerApiRoute("/projects", {
  method: "POST",
  handler: async (c) => {
    const userId = getUserId(c);
    const body = await c.req.json<{ name: string }>();

    if (!body.name?.trim()) {
      throw new HTTPException(400, { message: "name is required" });
    }

    const project = await createProject({
      id: generateId(),
      userId,
      name: body.name.trim(),
    });
    return c.json(project, 201);
  },
});

const getProjectRoute = registerApiRoute("/projects/:projectId", {
  method: "GET",
  handler: async (c) => {
    const userId = getUserId(c);
    const projectId = c.req.param("projectId");
    const project = await getProject(projectId);

    if (!project || project.userId !== userId) {
      throw new HTTPException(404, { message: "Project not found" });
    }
    return c.json(project);
  },
});

const deleteProjectRoute = registerApiRoute("/projects/:projectId", {
  method: "DELETE",
  handler: async (c) => {
    const userId = getUserId(c);
    const projectId = c.req.param("projectId");
    const project = await getProject(projectId);

    if (!project || project.userId !== userId) {
      throw new HTTPException(404, { message: "Project not found" });
    }

    await deleteProject(projectId);
    return c.json({ deleted: true });
  },
});

// --- Chats ---

const listChats = registerApiRoute("/projects/:projectId/chats", {
  method: "GET",
  handler: async (c) => {
    const userId = getUserId(c);
    const projectId = c.req.param("projectId");
    const project = await getProject(projectId);

    if (!project || project.userId !== userId) {
      throw new HTTPException(404, { message: "Project not found" });
    }

    const rows = await getChatsByProject(projectId);
    return c.json(rows);
  },
});

const createChatRoute = registerApiRoute("/projects/:projectId/chats", {
  method: "POST",
  handler: async (c) => {
    const userId = getUserId(c);
    const projectId = c.req.param("projectId");
    const project = await getProject(projectId);

    if (!project || project.userId !== userId) {
      throw new HTTPException(404, { message: "Project not found" });
    }

    const body = await c.req.json<{ title?: string }>().catch(() => ({ title: undefined }));
    const chat = await createChat({
      id: generateId(),
      projectId,
      title: body.title?.trim() || "New chat",
      threadId: generateId(),
    });
    return c.json(chat, 201);
  },
});

const getChatRoute = registerApiRoute(
  "/projects/:projectId/chats/:chatId",
  {
    method: "GET",
    handler: async (c) => {
      const userId = getUserId(c);
      const projectId = c.req.param("projectId");
      const project = await getProject(projectId);

      if (!project || project.userId !== userId) {
        throw new HTTPException(404, { message: "Project not found" });
      }

      const chat = await getChat(c.req.param("chatId"));
      if (!chat || chat.projectId !== projectId) {
        throw new HTTPException(404, { message: "Chat not found" });
      }
      return c.json(chat);
    },
  },
);

const updateChatRoute = registerApiRoute(
  "/projects/:projectId/chats/:chatId",
  {
    method: "PATCH",
    handler: async (c) => {
      const userId = getUserId(c);
      const projectId = c.req.param("projectId");
      const project = await getProject(projectId);

      if (!project || project.userId !== userId) {
        throw new HTTPException(404, { message: "Project not found" });
      }

      const chatId = c.req.param("chatId");
      const chat = await getChat(chatId);
      if (!chat || chat.projectId !== projectId) {
        throw new HTTPException(404, { message: "Chat not found" });
      }

      const body = await c.req.json<{ title: string }>();
      if (!body.title?.trim()) {
        throw new HTTPException(400, { message: "title is required" });
      }

      await updateChatTitle(chatId, body.title.trim());
      return c.json({ ...chat, title: body.title.trim() });
    },
  },
);

const deleteChatRoute = registerApiRoute(
  "/projects/:projectId/chats/:chatId",
  {
    method: "DELETE",
    handler: async (c) => {
      const userId = getUserId(c);
      const projectId = c.req.param("projectId");
      const project = await getProject(projectId);

      if (!project || project.userId !== userId) {
        throw new HTTPException(404, { message: "Project not found" });
      }

      const chatId = c.req.param("chatId");
      const chat = await getChat(chatId);
      if (!chat || chat.projectId !== projectId) {
        throw new HTTPException(404, { message: "Chat not found" });
      }

      await deleteChat(chatId);
      return c.json({ deleted: true });
    },
  },
);

export const apiRoutes = [
  listProjects,
  createProjectRoute,
  getProjectRoute,
  deleteProjectRoute,
  listChats,
  createChatRoute,
  getChatRoute,
  updateChatRoute,
  deleteChatRoute,
];
