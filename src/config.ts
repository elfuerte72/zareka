import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export interface ModelRef {
  providerID: string
  modelID: string
  label: string
}

// Читаем модель по умолчанию из конфига opencode: "provider/model-id".
// Model-id у Яндекса сам содержит слеши (gpt://…), поэтому режем только по первому.
export function defaultModel(): ModelRef {
  const configPath = join(homedir(), ".config", "opencode", "opencode.json")
  let raw: string
  try {
    raw = readFileSync(configPath, "utf8")
  } catch {
    throw new Error(
      `Не найден конфиг opencode (${configPath}). Запустите install.sh из репозитория Зареки.`,
    )
  }
  const config = JSON.parse(raw)
  const model: string | undefined = config.model
  if (!model || !model.includes("/")) {
    throw new Error(`В ${configPath} не задана модель по умолчанию (поле "model").`)
  }
  const slash = model.indexOf("/")
  const providerID = model.slice(0, slash)
  const modelID = model.slice(slash + 1)
  const configured = config.provider?.[providerID]?.models?.[modelID]?.name
  return { providerID, modelID, label: configured ?? modelID }
}
