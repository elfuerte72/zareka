#!/usr/bin/env bun
import { createOpencode } from "@opencode-ai/sdk"
import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { join } from "node:path"
import { defaultModel } from "./config"
import { playAudio } from "./audio"
import { App } from "./ui"

const model = defaultModel()
const directory = process.cwd()

const { client, server } = await startServer()
process.on("exit", () => server.close())

// Порт может держать осиротевший `opencode serve` от прошлого запуска —
// тогда пробуем следующие, а не падаем с невнятным «exited with code 1».
async function startServer() {
  const base = Number(process.env.ZAREKA_PORT ?? 4996)
  for (let port = base; port < base + 10; port++) {
    if (await portBusy(port)) continue
    try {
      return await createOpencode({ port, timeout: 20_000 })
    } catch (error) {
      if (await portBusy(port)) continue // порт заняли между проверкой и стартом
      throw error
    }
  }
  console.error(
    `Порты ${base}–${base + 9} заняты. Найдите старый сервер: lsof -nP -i :${base}\n` +
      `и остановите его (kill <PID>), либо задайте другой порт: ZAREKA_PORT=5100 bun start`,
  )
  process.exit(1)
}

async function portBusy(port: number): Promise<boolean> {
  try {
    const conn = await Bun.connect({
      hostname: "127.0.0.1",
      port,
      socket: { data() {} },
    })
    conn.end()
    return true
  } catch {
    return false
  }
}

// «Закрытый контур»: внешние MCP-серверы отключаем — их инструменты
// раздувают запрос (у Яндекса лимит 100 инструментов) и уводят данные наружу.
const disabledTools = await mcpOffMap()

const smokeIndex = process.argv.indexOf("--smoke")
if (smokeIndex !== -1) {
  await smoke(process.argv[smokeIndex + 1] ?? "Ответь одним словом: готово")
} else {
  await tui()
}

async function mcpOffMap(): Promise<Record<string, boolean>> {
  try {
    const cfg = await client.config.get({ query: { directory }, throwOnError: true })
    const mcp = (cfg.data as { mcp?: Record<string, unknown> }).mcp ?? {}
    return Object.fromEntries(Object.keys(mcp).map((name) => [`${name}_*`, false]))
  } catch {
    return {}
  }
}

async function smoke(prompt: string) {
  console.log(`Наркомпрог (smoke): модель ${model.providerID}/${model.modelID}`)
  if (Object.keys(disabledTools).length) {
    console.log(`Отключены внешние MCP: ${Object.keys(disabledTools).join(", ")}`)
  }
  const created = await client.session.create({ query: { directory }, throwOnError: true })
  console.log(`Сессия: ${created.data.id}`)
  const result = await client.session.prompt({
    path: { id: created.data.id },
    query: { directory },
    body: {
      model: { providerID: model.providerID, modelID: model.modelID },
      ...(Object.keys(disabledTools).length ? { tools: disabledTools } : {}),
      parts: [{ type: "text", text: prompt }],
    },
    throwOnError: true,
  })
  const data = result.data as {
    info?: { error?: unknown }
    parts?: Array<{ type: string; text?: string }>
  }
  if (data.info?.error) {
    console.log(`Ошибка модели: ${JSON.stringify(data.info.error).slice(0, 300)}`)
    server.close()
    process.exit(1)
  }
  const text = (data.parts ?? []).filter((p) => p.type === "text" && p.text).map((p) => p.text).join("\n")
  console.log(`Ответ: ${text || JSON.stringify(data).slice(0, 300)}`)
  server.close()
  process.exit(0)
}

async function tui() {
  const anthemFile =
    process.env.ZAREKA_ANTHEM ?? join(import.meta.dir, "..", "anthem-of-the-ussr-classical.mp3")
  const anthem = playAudio(anthemFile)
  process.on("exit", () => anthem.stop())

  const renderer = await createCliRenderer()

  // Восстановление терминала на внешних сигналах — иначе mouse tracking
  // остаётся включённым и после выхода в шелл сыплются коды («цифры»).
  const restoreAndExit = () => {
    try {
      renderer.destroy()
    } catch {
      // рендерер мог быть уже разрушен
    }
    anthem.stop()
    server.close()
    process.exit(0)
  }
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(sig, restoreAndExit)
  }

  createRoot(renderer).render(
    <App
      client={client}
      model={model}
      directory={directory}
      server={server}
      player={anthem}
      disabledTools={disabledTools}
    />,
  )

  // Тестовый хук: автовыход для проверки запуска TUI без живого терминала.
  const autoExit = Number(process.env.ZAREKA_AUTOEXIT_MS ?? 0)
  if (autoExit > 0) {
    setTimeout(() => {
      try {
        renderer.destroy()
      } catch {
        // рендерер мог быть уже разрушен
      }
      anthem.stop()
      server.close()
      process.exit(0)
    }, autoExit)
  }
}
