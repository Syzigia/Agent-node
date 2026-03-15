function readEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) {
      return value;
    }
  }

  return undefined;
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

export const mistralLarge3Deployment =
  process.env.AZURE_MISTRAL_LARGE_3_DEPLOYMENT ?? "Mistral-Large-3";

export const gpt5MiniDeployment =
  process.env.AZURE_GPT_5_MINI_DEPLOYMENT ?? "gpt-5-mini";

export const o4MiniDeployment =
  process.env.AZURE_O4_MINI_DEPLOYMENT ?? "o4-mini";

export const gpt5NanoDeployment =
  process.env.AZURE_GPT_5_NANO_DEPLOYMENT ?? "gpt-5-nano";

export const mistralLarge3ModelId = `azure-openai/${mistralLarge3Deployment}`;
export const gpt5MiniModelId = `azure-openai/${gpt5MiniDeployment}`;
export const o4MiniModelId = `azure-openai/${o4MiniDeployment}`;
export const gpt5NanoModelId = `azure-openai/${gpt5NanoDeployment}`;

export const azureGatewayDeployments = [
  mistralLarge3Deployment,
  gpt5MiniDeployment,
  o4MiniDeployment,
  gpt5NanoDeployment,
];
