import type { OpencodeClient } from "@opencode-ai/sdk"
import { useEffect, useMemo, useRef, useState } from "react"
import { useKeyboard } from "@opentui/react"
import type { ModelRef } from "./config"
import type { Player } from "./audio"
import { toolLabel } from "./tools"
import {
  emblemMotto,
  emblemStar,
  emblemWordmark,
  glyph,
  spinnerFrames,
  syntaxStyle,
  theme,
} from "./theme"

type ServerHandle = { url: string; close(): void }

type Item =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; text: string; done: boolean }
  | { kind: "tool"; id: string; tool: string; status: "pending" | "ok" | "error"; title?: string }
  | { kind: "system"; id: string; text: string }
  | { kind: "error"; id: string; text: string }

interface ServerEvent {
  type: string
  properties?: {
    part?: {
      id?: string
      callID?: string
      sessionID?: string
      messageID?: string
      type?: string
      text?: string
      tool?: string
      state?: { status?: string; title?: string }
    }
    sessionID?: string
    id?: string
    title?: string
    error?: { message?: string } | string
  }
}

const COMMANDS = [
  { name: "/новая", description: "начать новую сессию" },
  { name: "/очистить", description: "очистить экран" },
  { name: "/помощь", description: "справка по командам" },
  { name: "/выход", description: "выйти из Зареки" },
]

let idCounter = 0
const localId = () => `local-${++idCounter}`

export function App(props: {
  client: OpencodeClient
  model: ModelRef
  directory: string
  server: ServerHandle
  player: Player
}) {
  const { client, model, directory, player } = props
  const ss = useMemo(() => syntaxStyle(), [])

  const [items, setItems] = useState<Item[]>([])
  const [draft, setDraft] = useState("")
  const [resetKey, setResetKey] = useState(0)
  const [busySince, setBusySince] = useState<number | null>(null)
  const [tick, setTick] = useState(0)
  const [permission, setPermission] = useState<{ id: string; sessionID: string; title: string } | null>(null)
  const [musicOn, setMusicOn] = useState(player.playing)

  const sessionRef = useRef<string | undefined>(undefined)
  const permissionRef = useRef(permission)
  permissionRef.current = permission
  const busyRef = useRef(busySince)
  busyRef.current = busySince

  // Подписка на поток событий сервера (один раз).
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const events = await client.event.subscribe({ query: { directory } })
        for await (const event of events.stream as AsyncIterable<ServerEvent>) {
          if (!alive) break
          handleEvent(event)
        }
      } catch (error) {
        if (alive) push({ kind: "error", id: localId(), text: `поток событий оборвался: ${msg(error)}` })
      }
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Спиннер + таймер, пока агент занят.
  useEffect(() => {
    if (busySince == null) return
    const t = setInterval(() => setTick((n) => n + 1), 90)
    return () => clearInterval(t)
  }, [busySince])

  useKeyboard((key) => {
    // Пока играет гимн — Esc его выключает и больше ничего.
    if (player.playing) {
      if (key.name === "escape") {
        player.stop()
        setMusicOn(false)
        return
      }
    }
    if (key.ctrl && key.name === "c") {
      player.stop()
      process.exit(0)
    }
    if (key.name === "escape") {
      if (permissionRef.current) {
        void respond("reject")
        return
      }
      if (busyRef.current != null && sessionRef.current) {
        void client.session.abort({ path: { id: sessionRef.current }, query: { directory } }).catch(() => {})
        setBusySince(null)
      }
    }
  })

  function push(item: Item) {
    setItems((prev) => [...prev, item])
  }

  function upsert(id: string, make: () => Item, patch: (it: Item) => Item) {
    setItems((prev) => {
      const idx = prev.findIndex((it) => it.id === id)
      if (idx === -1) return [...prev, make()]
      const next = prev.slice()
      next[idx] = patch(next[idx])
      return next
    })
  }

  function handleEvent(event: ServerEvent) {
    const p = event.properties
    if (event.type === "message.part.updated" && p?.part) {
      const part = p.part
      if (sessionRef.current && part.sessionID && part.sessionID !== sessionRef.current) return
      const id = part.id ?? part.callID ?? localId()
      if (part.type === "text" && typeof part.text === "string") {
        upsert(
          id,
          () => ({ kind: "assistant", id, text: part.text!, done: false }),
          (it) => (it.kind === "assistant" ? { ...it, text: part.text! } : it),
        )
      } else if (part.type === "tool" && part.tool) {
        const status = part.state?.status === "completed" ? "ok" : part.state?.status === "error" ? "error" : "pending"
        const title = part.state?.title
        upsert(
          id,
          () => ({ kind: "tool", id, tool: part.tool!, status, title }),
          (it) => (it.kind === "tool" ? { ...it, status, title } : it),
        )
      }
    } else if (event.type === "session.idle" && p?.sessionID === sessionRef.current) {
      setBusySince(null)
      setItems((prev) => prev.map((it) => (it.kind === "assistant" ? { ...it, done: true } : it)))
    } else if (event.type === "session.error") {
      push({ kind: "error", id: localId(), text: msg(p?.error) })
      setBusySince(null)
    } else if (event.type === "permission.updated" && p?.id) {
      setPermission({ id: p.id, sessionID: p.sessionID ?? sessionRef.current ?? "", title: p.title ?? "действие агента" })
    }
  }

  async function respond(response: "once" | "always" | "reject") {
    const perm = permissionRef.current
    setPermission(null)
    if (!perm) return
    try {
      await (client as unknown as {
        postSessionIdPermissionsPermissionId: (o: unknown) => Promise<unknown>
      }).postSessionIdPermissionsPermissionId({
        path: { id: perm.sessionID, permissionID: perm.id },
        query: { directory },
        body: { response },
      })
    } catch (error) {
      push({ kind: "error", id: localId(), text: `не удалось ответить на разрешение: ${msg(error)}` })
    }
  }

  async function ensureSession(): Promise<string> {
    if (sessionRef.current) return sessionRef.current
    const created = await client.session.create({ query: { directory }, throwOnError: true })
    sessionRef.current = created.data.id
    return created.data.id
  }

  async function sendPrompt(text: string) {
    push({ kind: "user", id: localId(), text })
    setBusySince(Date.now())
    try {
      const id = await ensureSession()
      await client.session.prompt({
        path: { id },
        query: { directory },
        body: { model: { providerID: model.providerID, modelID: model.modelID }, parts: [{ type: "text", text }] },
        throwOnError: true,
      })
    } catch (error) {
      push({ kind: "error", id: localId(), text: msg(error) })
      setBusySince(null)
    }
  }

  function runCommand(name: string) {
    switch (name) {
      case "/выход":
        player.stop()
        process.exit(0)
        break
      case "/очистить":
        setItems([])
        break
      case "/новая":
        sessionRef.current = undefined
        setItems([])
        push({ kind: "system", id: localId(), text: "Начата новая сессия." })
        break
      case "/помощь":
        push({
          kind: "system",
          id: localId(),
          text: "Команды: " + COMMANDS.map((c) => `${c.name} — ${c.description}`).join("; "),
        })
        break
      default:
        push({ kind: "system", id: localId(), text: `Неизвестная команда: ${name}` })
    }
  }

  function handleSubmit(value: string) {
    const text = value.trim()
    setDraft("")
    setResetKey((k) => k + 1)
    if (!text) return
    if (player.playing) {
      player.stop()
      setMusicOn(false)
    }
    if (text.startsWith("/")) {
      const exact = COMMANDS.find((c) => c.name === text)
      const prefix = COMMANDS.filter((c) => c.name.startsWith(text))
      runCommand(exact?.name ?? prefix[0]?.name ?? text)
      return
    }
    void sendPrompt(text)
  }

  const slash = draft.startsWith("/")
  const suggestions = slash ? COMMANDS.filter((c) => c.name.startsWith(draft)) : []
  const seconds = busySince != null ? Math.floor((Date.now() - busySince) / 1000) : 0
  const frame = spinnerFrames[tick % spinnerFrames.length]

  return (
    <box flexDirection="column" width="100%" height="100%">
      {/* Шапка-эмблема */}
      <box
        border
        borderStyle="double"
        borderColor={theme.accent}
        flexDirection="column"
        alignItems="center"
      >
        <text fg={theme.gold}>{emblemStar}</text>
        <text fg={theme.accent}>
          <b>{emblemWordmark}</b>
        </text>
        <text fg={theme.gold}>{emblemMotto}</text>
        <text fg={theme.muted}>модель: {model.label}</text>
      </box>

      {/* Транскрипт */}
      <scrollbox flexGrow={1} stickyScroll stickyStart="bottom" paddingLeft={1} paddingRight={1}>
        {items.map((it) => (
          <MessageView key={it.id} item={it} ss={ss} />
        ))}
      </scrollbox>

      {/* Модалка разрешения */}
      {permission && (
        <box border borderStyle="double" borderColor={theme.gold} flexDirection="column" paddingLeft={1} paddingRight={1}>
          <text fg={theme.gold}>{glyph.star} Требуется разрешение</text>
          <text fg={theme.user}>{permission.title}</text>
          <text fg={theme.muted}>1 — разрешить · 2 — на сессию · 3/Esc — отклонить</text>
          <PermissionKeys onRespond={respond} />
        </box>
      )}

      {/* Подсказка слэш-команд */}
      {slash && suggestions.length > 0 && (
        <box border borderStyle="rounded" borderColor={theme.gold} flexDirection="column" paddingLeft={1} paddingRight={1}>
          {suggestions.map((c) => (
            <text key={c.name} fg={theme.gold}>
              {c.name} <span fg={theme.muted}>— {c.description}</span>
            </text>
          ))}
        </box>
      )}

      {/* Поле ввода */}
      <box border borderStyle="rounded" borderColor={theme.accent} paddingLeft={1} paddingRight={1}>
        <input
          key={resetKey}
          focused={!permission}
          placeholder="Спросите Зареку…  ( / — команды, Enter — отправить )"
          onInput={setDraft}
          // Тег <input> пересекается с DOM-типами React; onSubmit у OpenTUI отдаёт строку.
          onSubmit={handleSubmit as never}
        />
      </box>

      {/* Футер-статус */}
      <box paddingLeft={1} flexDirection="row">
        {musicOn && player.playing ? (
          <text fg={theme.gold}>♪ Гимн СССР — Esc, чтобы выключить</text>
        ) : busySince != null ? (
          <text fg={theme.accent}>
            {frame} думаю… {seconds}с <span fg={theme.muted}>· Esc — прервать</span>
          </text>
        ) : (
          <text fg={theme.muted}>Готова {glyph.hammerSickle}</text>
        )}
      </box>
    </box>
  )
}

function MessageView({ item, ss }: { item: Item; ss: ReturnType<typeof syntaxStyle> }) {
  if (item.kind === "user") {
    return (
      <box flexDirection="row" paddingTop={1}>
        <text fg={theme.muted}>{glyph.user} </text>
        <text fg={theme.user}>{item.text}</text>
      </box>
    )
  }
  if (item.kind === "assistant") {
    return (
      <box flexDirection="column" paddingTop={1}>
        <text fg={theme.accent}>{glyph.agent} Зарека</text>
        {parseBlocks(item.text).map((b, idx) =>
          b.type === "code" ? (
            <code key={idx} content={b.content} filetype={b.lang ?? "text"} syntaxStyle={ss} />
          ) : (
            <ProseBlock key={idx} text={b.content} />
          ),
        )}
      </box>
    )
  }
  if (item.kind === "tool") {
    const color = item.status === "ok" ? theme.success : item.status === "error" ? theme.error : theme.accent
    const mark = item.status === "ok" ? glyph.ok : item.status === "error" ? glyph.fail : glyph.pending
    return (
      <box border borderStyle="rounded" borderColor={color} paddingLeft={1} paddingRight={1} paddingTop={1} marginTop={1}>
        <text fg={color}>
          {mark} {toolLabel(item.tool)}
          {item.title ? ` — ${item.title}` : ""}
        </text>
      </box>
    )
  }
  if (item.kind === "system") {
    return (
      <box paddingTop={1}>
        <text fg={theme.gold}>{item.text}</text>
      </box>
    )
  }
  return (
    <box paddingTop={1}>
      <text fg={theme.error}>Ошибка: {item.text}</text>
    </box>
  )
}

// Разбор ответа на блоки прозы и кода. Компонент <markdown> в текущей версии
// OpenTUI прозу не рендерит, поэтому прозу выводим сами, а код — через <code>.
function parseBlocks(text: string): Array<{ type: "text" | "code"; lang?: string; content: string }> {
  const blocks: Array<{ type: "text" | "code"; lang?: string; content: string }> = []
  const lines = text.split("\n")
  let buf: string[] = []
  const flush = () => {
    if (buf.length) {
      blocks.push({ type: "text", content: buf.join("\n") })
      buf = []
    }
  }
  let i = 0
  while (i < lines.length) {
    const open = /^```(\w+)?\s*$/.exec(lines[i])
    if (open) {
      flush()
      const lang = open[1]
      i++
      const code: string[] = []
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        code.push(lines[i])
        i++
      }
      if (i < lines.length) i++ // пропустить закрывающую ```
      blocks.push({ type: "code", lang, content: code.join("\n") })
    } else {
      buf.push(lines[i])
      i++
    }
  }
  flush()
  return blocks
}

function inlineClean(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/`(.+?)`/g, "$1")
}

// Лёгкая проза: заголовки, списки, обычные строки. Без полноценного markdown.
function ProseBlock({ text }: { text: string }) {
  const lines = text.split("\n")
  return (
    <box flexDirection="column">
      {lines.map((ln, i) => {
        if (ln.trim() === "") return <text key={i}> </text>
        const heading = /^(#{1,6})\s+(.*)$/.exec(ln)
        if (heading)
          return (
            <text key={i} fg={theme.gold}>
              <b>{inlineClean(heading[2])}</b>
            </text>
          )
        const li = /^\s*[-*]\s+(.*)$/.exec(ln)
        if (li) return <text key={i}>  {glyph.arrow} {inlineClean(li[1])}</text>
        return <text key={i}>{inlineClean(ln)}</text>
      })}
    </box>
  )
}

// Ловит 1/2/3 для ответа на разрешение (Esc обрабатывается глобально).
function PermissionKeys({ onRespond }: { onRespond: (r: "once" | "always" | "reject") => void }) {
  useKeyboard((key) => {
    if (key.name === "1") onRespond("once")
    else if (key.name === "2") onRespond("always")
    else if (key.name === "3") onRespond("reject")
  })
  return null
}

function msg(error: unknown): string {
  if (!error) return "неизвестная ошибка"
  if (typeof error === "string") return error
  if (error instanceof Error) return error.message
  if (typeof error === "object" && "message" in error) return String((error as { message: unknown }).message)
  return String(error)
}
