import { MastraModelGateway, type ProviderConfig } from "@mastra/core/llm";
import { createAzure } from "@ai-sdk/azure";

interface AzureResourceOverride {
  /** Use when the deployment lives in a different Azure resource (builds URL from resource name). */
  resourceName?: string;
  /** Use when you need a fully custom base URL (takes precedence over resourceName). */
  baseURL?: string;
  /** API key specific to this resource / deployment. */
  apiKey: string;
}

export interface MultiResourceAzureGatewayConfig {
  /** Default Azure resource name (used for deployments without an override). */
  defaultResourceName: string;
  /** Default API key. */
  defaultApiKey: string;
  /** API version sent as query param on every request. */
  apiVersion?: string;
  /** Full list of deployment names exposed to Studio. */
  deployments: string[];
  /** Per-deployment overrides that point to a different Azure resource / key. */
  overrides?: Record<string, AzureResourceOverride>;
}

export class MultiResourceAzureGateway extends MastraModelGateway {
  readonly id = "azure-openai" as const;
  readonly name = "Azure OpenAI";

  private cfg: MultiResourceAzureGatewayConfig;

  constructor(config: MultiResourceAzureGatewayConfig) {
    super();
    this.cfg = config;
  }

  async fetchProviders(): Promise<Record<string, ProviderConfig>> {
    return {
      "azure-openai": {
        name: "Azure OpenAI",
        models: this.cfg.deployments,
        apiKeyEnvVar: [],
        apiKeyHeader: "api-key",
        gateway: this.id,
      },
    };
  }

  buildUrl(): undefined {
    return undefined;
  }

  async getApiKey(modelId: string): Promise<string> {
    // modelId arrives as the full router id, e.g. "azure-openai/gpt-5.3-chat"
    const deployment = modelId.replace(/^azure-openai\//, "");
    return this.cfg.overrides?.[deployment]?.apiKey ?? this.cfg.defaultApiKey;
  }

  resolveLanguageModel({
    modelId,
    apiKey,
    headers,
  }: {
    modelId: string;
    providerId: string;
    apiKey: string;
    headers?: Record<string, string>;
  }) {
    const apiVersion = this.cfg.apiVersion || "2024-04-01-preview";
    const override = this.cfg.overrides?.[modelId];

    if (override?.baseURL) {
      return createAzure({
        baseURL: override.baseURL,
        apiKey,
        apiVersion,
        useDeploymentBasedUrls: true,
        headers,
      }).chat(modelId);
    }

    return createAzure({
      resourceName: override?.resourceName ?? this.cfg.defaultResourceName,
      apiKey,
      apiVersion,
      useDeploymentBasedUrls: true,
      headers,
    }).chat(modelId);
  }
}
