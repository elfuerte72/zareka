import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export interface ModelRef {
  providerID: string
  modelID: string
  label: string
}

const configPath = join(homedir(), ".config", "opencode", "opencode.json")

function readConfig(): {
  model?: string
  provider?: Record<string, { name?: string; models?: Record<string, { name?: string }> }>
} {
  let raw: string
  try {
    raw = readFileSync(configPath, "utf8")
  } catch {
    throw new Error(
      `Не найден конфиг opencode (${configPath}). Запустите install.sh из репозитория Зареки.`,
    )
  }
  return JSON.parse(raw)
}

// Модель по умолчанию из конфига: "provider/model-id".
// Model-id у Яндекса сам содержит слеши (gpt://…), поэтому режем только по первому.
export function defaultModel(): ModelRef {
  const config = readConfig()
  const model = config.model
  if (!model || !model.includes("/")) {
    throw new Error(`В ${configPath} не задана модель по умолчанию (поле "model").`)
  }
  const slash = model.indexOf("/")
  const providerID = model.slice(0, slash)
  const modelID = model.slice(slash + 1)
  const configured = config.provider?.[providerID]?.models?.[modelID]?.name
  return { providerID, modelID, label: configured ?? modelID }
}

// Все модели всех провайдеров из конфига — для пикера /распределение.
export function listModels(): ModelRef[] {
  const config = readConfig()
  const result: ModelRef[] = []
  for (const [providerID, provider] of Object.entries(config.provider ?? {})) {
    for (const [modelID, m] of Object.entries(provider.models ?? {})) {
      result.push({ providerID, modelID, label: m.name ?? modelID })
    }
  }
  return result
}
