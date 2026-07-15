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

async function smoke(prompt: string) {
  console.log(`Зарека (smoke): модель ${model.providerID}/${model.modelID}`)
  const created = await client.session.create({ query: { directory }, throwOnError: true })
  console.log(`Сессия: ${created.data.id}`)
  const result = await client.session.prompt({
    path: { id: created.data.id },
    query: { directory },
    body: {
      model: { providerID: model.providerID, modelID: model.modelID },
      parts: [{ type: "text", text: prompt }],
    },
    throwOnError: true,
  })
  const parts = (result.data as { parts?: Array<{ type: string; text?: string }> }).parts ?? []
  const text = parts.filter((p) => p.type === "text" && p.text).map((p) => p.text).join("\n")
  console.log(`Ответ: ${text || JSON.stringify(result.data).slice(0, 400)}`)
  server.close()
  process.exit(0)
}

async function tui() {
  const anthemFile =
    process.env.ZAREKA_ANTHEM ?? join(import.meta.dir, "..", "anthem-of-the-ussr-classical.mp3")
  const anthem = playAudio(anthemFile)
  process.on("exit", () => anthem.stop())

  const renderer = await createCliRenderer()
  createRoot(renderer).render(
    <App client={client} model={model} directory={directory} server={server} player={anthem} />,
  )

  // Тестовый хук: автовыход для проверки запуска без живого терминала.
  const autoExit = Number(process.env.ZAREKA_AUTOEXIT_MS ?? 0)
  if (autoExit > 0) {
    setTimeout(() => {
      anthem.stop()
      server.close()
      process.exit(0)
    }, autoExit)
  }
}
