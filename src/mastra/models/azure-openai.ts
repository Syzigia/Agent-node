function readEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) {
      return value;
    }
  }

  return undefined;
}

function stripInlineComment(value: string): string {
  const hashIndex = value.indexOf("#");
  if (hashIndex === -1) {
    return value.trim();
  }

  return value.slice(0, hashIndex).trim();
}

function normalizeBaseUrl(value: string): string {
  const stripped = stripInlineComment(value).trim().replace(/\/$/, "");
  if (!stripped) {
    return stripped;
  }

  return stripped.endsWith("/openai") ? stripped : `${stripped}/openai`;
}

function readDeploymentEnv(name: string, fallback: string): string {
  const value = readEnv(name);
  if (!value) {
    return fallback;
  }

  return stripInlineComment(value) || fallback;
}

const resolvedAzureApiKey = readEnv("AZURE_API_KEY", "AZURE_OPENAI_API_KEY");

if (!resolvedAzureApiKey) {
  throw new Error(
    "Azure API key is not set. Use AZURE_API_KEY (preferred) or AZURE_OPENAI_API_KEY.",
  );
}

export const azureApiKey = resolvedAzureApiKey;

const resolvedAzureResourceName = readEnv(
  "AZURE_RESOURCE_NAME",
  "AZURE_OPENAI_RESOURCE_NAME",
);

if (!resolvedAzureResourceName) {
  throw new Error(
    "Azure resource name is not set. Use AZURE_RESOURCE_NAME (preferred) or AZURE_OPENAI_RESOURCE_NAME.",
  );
}

export const azureResourceName = resolvedAzureResourceName;

export const azureApiVersion = readEnv(
  "AZURE_API_VERSION",
  "AZURE_OPENAI_API_VERSION",
) ?? "2024-04-01-preview";

export const azureDirectApiKey = readEnv(
  "AZURE_DIRECT_API_KEY",
  "AZURE_GPT_5_3_CHAT_API_KEY",
  "AZURE_API_KEY_EASTUS2",
) ?? azureApiKey;

export const azureDirectBaseUrl = readEnv(
  "AZURE_DIRECT_BASE_URL",
  "AZURE_GPT_5_3_CHAT_BASE_URL",
  "AZURE_GPT_5_3_CHAT_ENDPOINT",
  "AZURE_BASE_URL_EASTUS2",
  "AZURE_BASE_URL",
  "AZURE_OPENAI_BASE_URL",
);

export const normalizedAzureDirectBaseUrl = azureDirectBaseUrl
  ? normalizeBaseUrl(azureDirectBaseUrl)
  : undefined;

export const mistralLarge3Deployment =
  readDeploymentEnv("AZURE_MISTRAL_LARGE_3_DEPLOYMENT", "Mistral-Large-3");

export const gpt5MiniDeployment =
  readDeploymentEnv("AZURE_GPT_5_MINI_DEPLOYMENT", "gpt-5-mini");

export const gpt53ChatDeployment =
  readDeploymentEnv("AZURE_GPT_5_3_CHAT_DEPLOYMENT", "gpt-5.3-chat");

export const o4MiniDeployment =
  readDeploymentEnv("AZURE_O4_MINI_DEPLOYMENT", "o4-mini");

export const gpt5NanoDeployment =
  readDeploymentEnv("AZURE_GPT_5_NANO_DEPLOYMENT", "gpt-5-nano");

export const mistralLarge3ModelId = `azure-openai/${mistralLarge3Deployment}`;
export const gpt5MiniModelId = `azure-openai/${gpt5MiniDeployment}`;
export const gpt53ChatModelId = `azure-openai/${gpt53ChatDeployment}`;
export const o4MiniModelId = `azure-openai/${o4MiniDeployment}`;
export const gpt5NanoModelId = `azure-openai/${gpt5NanoDeployment}`;

export const azureGatewayDeployments = [
  mistralLarge3Deployment,
  gpt5MiniDeployment,
  gpt53ChatDeployment,
  o4MiniDeployment,
  gpt5NanoDeployment,
];
