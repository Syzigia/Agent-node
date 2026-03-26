import { Agent } from "@mastra/core/agent";
import { gpt53ChatModelId } from "../../models/azure-openai";

export const writerAgent = new Agent({
    id: "writer-agent",
    name: "Writer Agent",
    description: "An agent that writes content based on info it receives",
    instructions: `You are an expert technical writer. Follow the instructions provided in each prompt carefully. Always respond with valid JSON when requested.`,
    model: gpt53ChatModelId,
})