#!/usr/bin/env bun
import { createOpencode } from "@opencode-ai/sdk"
import { defaultModel } from "./config"
import { ZarekaUI } from "./ui"

const model = defaultModel()
const directory = process.cwd()

const { client, server } = await createOpencode({
  port: Number(process.env.ZAREKA_PORT ?? 4996),
  timeout: 20_000,
})
process.on("exit", () => server.close())

const smokeIndex = process.argv.indexOf("--smoke")
if (smokeIndex !== -1) {
  await smoke(process.argv[smokeIndex + 1] ?? "Ответь одним словом: готово")
} else {
  await tui()
}

async function createSession(): Promise<string> {
  const created = await client.session.create({
    query: { directory },
    throwOnError: true,
  })
  return created.data.id
}

function sendPrompt(sessionID: string, text: string) {
  return client.session.prompt({
    path: { id: sessionID },
    query: { directory },
    body: {
      model: { providerID: model.providerID, modelID: model.modelID },
      parts: [{ type: "text", text }],
    },
    throwOnError: true,
  })
}

// Проверка всей связки без TUI: сервер → сессия → модель → ответ.
async function smoke(prompt: string) {
  console.log(`Зарека (smoke): модель ${model.providerID}/${model.modelID}`)
  const sessionID = await createSession()
  console.log(`Сессия: ${sessionID}`)
  const result = await sendPrompt(sessionID, prompt)
  const parts = (result.data as { parts?: Array<{ type: string; text?: string }> }).parts ?? []
  const text = parts.filter((p) => p.type === "text" && p.text).map((p) => p.text).join("\n")
  console.log(`Ответ: ${text || JSON.stringify(result.data).slice(0, 400)}`)
  server.close()
  process.exit(0)
}

interface ServerEvent {
  type: string
  properties?: {
    part?: {
      id?: string
      sessionID?: string
      messageID?: string
      type?: string
      text?: string
      tool?: string
      state?: { status?: string; title?: string }
    }
    sessionID?: string
  }
}

async function tui() {
  let sessionID: string | undefined

  const ui = await ZarekaUI.create(model.label, (text) => void send(text))

  // Тестовый хук: автовыход для проверки запуска TUI без живого терминала.
  const autoExit = Number(process.env.ZAREKA_AUTOEXIT_MS ?? 0)
  if (autoExit > 0) {
    setTimeout(() => {
      server.close()
      process.exit(0)
    }, autoExit)
  }

  async function send(text: string) {
    ui.addUser(text)
    ui.setStatus("Думаю…")
    try {
      sessionID ??= await createSession()
      await sendPrompt(sessionID, text)
      ui.setStatus("Готова")
    } catch (error) {
      ui.addError(error instanceof Error ? error.message : String(error))
      ui.setStatus("Ошибка")
    }
  }

  // Общий поток событий сервера двигает ленту чата.
  void (async () => {
    try {
      const events = await client.event.subscribe({ query: { directory } })
      for await (const event of events.stream as AsyncIterable<ServerEvent>) {
        handle(event)
      }
    } catch (error) {
      ui.addError(`Поток событий оборвался: ${error instanceof Error ? error.message : error}`)
    }
  })()

  function handle(event: ServerEvent) {
    if (event.type === "message.part.updated") {
      const part = event.properties?.part
      if (!part || (sessionID && part.sessionID !== sessionID)) return
      const key = part.id ?? `${part.messageID}-?`
      if (part.type === "text" && part.text) {
        ui.upsertPart(key, `Зарека: ${part.text}`, "text")
      } else if (part.type === "tool" && part.tool) {
        const title = part.state?.title ? ` — ${part.state.title}` : ""
        const status = part.state?.status === "completed" ? "✓" : "→"
        ui.upsertPart(key, `${status} ${toolLabel(part.tool)}${title}`, "tool")
      }
    } else if (event.type === "session.idle" && event.properties?.sessionID === sessionID) {
      ui.setStatus("Готова")
    }
  }
}

// Русские подписи инструментов агента.
function toolLabel(tool: string): string {
  const labels: Record<string, string> = {
    read: "читаю файл",
    write: "пишу файл",
    edit: "правлю файл",
    bash: "выполняю команду",
    grep: "ищу по коду",
    glob: "ищу файлы",
    list: "смотрю каталог",
    webfetch: "открываю страницу",
    todowrite: "обновляю план",
    todoread: "смотрю план",
    task: "запускаю подзадачу",
  }
  return labels[tool] ?? tool
}
