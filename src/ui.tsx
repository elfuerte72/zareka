import type { OpencodeClient } from "@opencode-ai/sdk"
import { useEffect, useMemo, useRef, useState } from "react"
import { useKeyboard } from "@opentui/react"
import { listModels, type ModelRef } from "./config"
import type { Player } from "./audio"
import { toolLabel } from "./tools"
import {
  emblemArt,
  emblemMotto,
  glyph,
  spinnerFrames,
  syntaxStyle,
  theme,
  wordmarkArt,
} from "./theme"

type ServerHandle = { url: string; close(): void }

type Item =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; text: string; done: boolean }
  | { kind: "tool"; id: string; tool: string; status: "pending" | "ok" | "error"; title?: string }
  | { kind: "system"; id: string; text: string }
  | { kind: "error"; id: string; text: string }

type Mode = "plan" | "build"

const MODES: Record<Mode, { title: string; hint: string; color: string }> = {
  plan: { title: "ГОСПЛАН", hint: "режим планирования", color: "#ffd700" },
  build: { title: "ИСПОЛКОМ", hint: "режим исполнения", color: "#e4181c" },
}

interface Command {
  name: string
  aliases: string[]
  description: string
}

const COMMANDS: Command[] = [
  { name: "/открыть-дело", aliases: ["/new"], description: "новая сессия" },
  { name: "/чистка", aliases: ["/clear"], description: "очистить экран" },
  { name: "/пятилетка", aliases: ["/init"], description: "изучить проект и составить AGENTS.md" },
  { name: "/распределение", aliases: ["/model"], description: "выбрать модель" },
  { name: "/главк", aliases: ["/provider"], description: "выбрать провайдера" },
  { name: "/помощь", aliases: ["/help"], description: "справка по командам" },
  { name: "/выход", aliases: ["/exit", "/quit"], description: "покинуть пост" },
]

const INIT_PROMPT =
  "Изучи структуру этого проекта (файлы, зависимости, команды сборки и тестов) и создай файл AGENTS.md " +
  "с краткой инструкцией для кодинг-агента: что это за проект, как собирать, как тестировать, какие есть соглашения. Пиши по-русски."

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

let idCounter = 0
const localId = () => `local-${++idCounter}`

export function App(props: {
  client: OpencodeClient
  model: ModelRef
  directory: string
  server: ServerHandle
  player: Player
}) {
  const { client, directory, player } = props
  const ss = useMemo(() => syntaxStyle(), [])
  const models = useMemo(() => listModels(), [])

  const [items, setItems] = useState<Item[]>([])
  const [draft, setDraft] = useState("")
  const [resetKey, setResetKey] = useState(0)
  const [busySince, setBusySince] = useState<number | null>(null)
  const [tick, setTick] = useState(0)
  const [permission, setPermission] = useState<{ id: string; sessionID: string; title: string } | null>(null)
  const [musicOn, setMusicOn] = useState(player.playing)
  const [mode, setMode] = useState<Mode>("build")
  const [model, setModel] = useState<ModelRef>(props.model)
  const [picker, setPicker] = useState<"model" | "provider" | null>(null)

  const sessionRef = useRef<string | undefined>(undefined)
  const permissionRef = useRef(permission)
  permissionRef.current = permission
  const busyRef = useRef(busySince)
  busyRef.current = busySince
  const pickerRef = useRef(picker)
  pickerRef.current = picker
  const modeRef = useRef(mode)
  modeRef.current = mode
  const modelRef = useRef(model)
  modelRef.current = model

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
    if (key.ctrl && key.name === "c") {
      player.stop()
      process.exit(0)
    }
    // Shift+Tab — переключение режима Госплан/Исполком.
    if (key.name === "tab" && key.shift) {
      setMode((m) => (m === "plan" ? "build" : "plan"))
      return
    }
    if (key.name === "escape") {
      if (player.playing) {
        player.stop()
        setMusicOn(false)
        return
      }
      if (pickerRef.current) {
        setPicker(null)
        return
      }
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

  async function sendPrompt(text: string, opts?: { silent?: boolean }) {
    if (!opts?.silent) push({ kind: "user", id: localId(), text })
    setBusySince(Date.now())
    try {
      const id = await ensureSession()
      const m = modelRef.current
      await client.session.prompt({
        path: { id },
        query: { directory },
        body: {
          model: { providerID: m.providerID, modelID: m.modelID },
          agent: modeRef.current,
          parts: [{ type: "text", text }],
        },
        throwOnError: true,
      })
    } catch (error) {
      push({ kind: "error", id: localId(), text: msg(error) })
      setBusySince(null)
    }
  }

  function findCommand(input: string): Command | undefined {
    const lower = input.toLowerCase()
    return (
      COMMANDS.find((c) => c.name === lower || c.aliases.includes(lower)) ??
      COMMANDS.find((c) => c.name.startsWith(lower))
    )
  }

  function runCommand(cmd: Command) {
    switch (cmd.name) {
      case "/выход":
        player.stop()
        process.exit(0)
        break
      case "/чистка":
        setItems([])
        break
      case "/открыть-дело":
        sessionRef.current = undefined
        setItems([])
        push({ kind: "system", id: localId(), text: `${glyph.star} Дело открыто. Новая сессия.` })
        break
      case "/пятилетка":
        push({ kind: "system", id: localId(), text: `${glyph.star} Пятилетка объявлена: составляем AGENTS.md.` })
        void sendPrompt(INIT_PROMPT, { silent: true })
        break
      case "/распределение":
        setPicker("model")
        break
      case "/главк":
        setPicker("provider")
        break
      case "/помощь":
        push({
          kind: "system",
          id: localId(),
          text: COMMANDS.map((c) => `${c.name} (${c.aliases[0]}) — ${c.description}`).join("\n"),
        })
        break
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
      const cmd = findCommand(text)
      if (cmd) runCommand(cmd)
      else push({ kind: "system", id: localId(), text: `Неизвестная команда: ${text}. Смотрите /помощь.` })
      return
    }
    void sendPrompt(text)
  }

  const slash = draft.startsWith("/")
  const suggestions = slash
    ? COMMANDS.filter((c) => c.name.startsWith(draft.toLowerCase()) || c.aliases.some((a) => a.startsWith(draft.toLowerCase())))
    : []
  const seconds = busySince != null ? Math.floor((Date.now() - busySince) / 1000) : 0
  const frame = spinnerFrames[tick % spinnerFrames.length]
  const m = MODES[mode]
  const inputFocused = !permission && !picker

  return (
    <box flexDirection="column" width="100%" height="100%">
      {/* Шапка: эмблема слева, CCCP и подписи справа */}
      <box
        border
        borderStyle="double"
        borderColor={theme.accent}
        height={emblemArt.length + 2}
        flexDirection="row"
        justifyContent="center"
        alignItems="center"
      >
        <box flexDirection="column" marginRight={4}>
          {emblemArt.map((line, i) => (
            <text key={i} fg={theme.accent}>
              {line}
            </text>
          ))}
        </box>
        <box flexDirection="column">
          {wordmarkArt.map((line, i) => (
            <text key={i} fg={theme.gold}>
              {line}
            </text>
          ))}
          <text> </text>
          <text fg={theme.gold}>{emblemMotto}</text>
          <text fg={theme.muted}>модель: {model.label}</text>
        </box>
      </box>

      {/* Транскрипт */}
      <scrollbox flexGrow={1} stickyScroll stickyStart="bottom" paddingLeft={1} paddingRight={1}>
        {items.map((it) => (
          <MessageView key={it.id} item={it} ss={ss} />
        ))}
      </scrollbox>

      {/* Модалка разрешения */}
      {permission && (
        <box
          border
          borderStyle="double"
          borderColor={theme.gold}
          height={5}
          flexDirection="column"
          paddingLeft={1}
          paddingRight={1}
        >
          <text fg={theme.gold}>{glyph.star} Требуется санкция</text>
          <text fg={theme.user}>{permission.title}</text>
          <text fg={theme.muted}>1 — разрешить · 2 — на всю сессию · 3/Esc — отказать</text>
          <PermissionKeys onRespond={respond} />
        </box>
      )}

      {/* Пикер модели / провайдера */}
      {picker === "model" && (
        <box border borderStyle="double" borderColor={theme.gold} height={Math.min(models.length, 6) + 3} flexDirection="column" paddingLeft={1} paddingRight={1}>
          <text fg={theme.gold}>{glyph.star} Распределение: выберите модель (Esc — отмена)</text>
          <select
            focused
            options={models.map((mm) => ({
              name: (mm.modelID === model.modelID ? "● " : "  ") + mm.label,
              description: mm.providerID,
              value: mm,
            }))}
            onSelect={(_i, opt) => {
              const value = opt?.value as ModelRef | undefined
              if (value) {
                setModel(value)
                push({ kind: "system", id: localId(), text: `${glyph.ok} Распределено: ${value.label}` })
              }
              setPicker(null)
            }}
          />
        </box>
      )}
      {picker === "provider" && (
        <box border borderStyle="double" borderColor={theme.gold} height={5} flexDirection="column" paddingLeft={1} paddingRight={1}>
          <text fg={theme.gold}>{glyph.star} Главк: выберите провайдера (Esc — отмена)</text>
          <select
            focused
            options={[
              { name: "● Yandex AI Studio — действующий", description: "оплата в рублях", value: "yandex" },
              { name: "  GigaChat (Сбер) — ожидает постановления", description: "в разработке", value: "gigachat" },
            ]}
            onSelect={(_i, opt) => {
              if (opt?.value === "gigachat") {
                push({ kind: "system", id: localId(), text: "ГигаЧат ещё не введён в эксплуатацию — следите за пятилеткой." })
              }
              setPicker(null)
            }}
          />
        </box>
      )}

      {/* Подсказка слэш-команд */}
      {inputFocused && slash && suggestions.length > 0 && (
        <box
          border
          borderStyle="rounded"
          borderColor={theme.gold}
          height={suggestions.length + 2}
          flexDirection="column"
          paddingLeft={1}
          paddingRight={1}
        >
          {suggestions.map((c) => (
            <text key={c.name} fg={theme.gold}>
              {c.name} <span fg={theme.muted}>({c.aliases[0]}) — {c.description}</span>
            </text>
          ))}
        </box>
      )}

      {/* Поле ввода */}
      <box border borderStyle="rounded" borderColor={theme.accent} height={3} paddingLeft={1} paddingRight={1}>
        <input
          key={resetKey}
          focused={inputFocused}
          placeholder="Слушаю, товарищ…  (/ — команды, Shift+Tab — режим, Enter — отправить)"
          onInput={setDraft}
          // Тег <input> пересекается с DOM-типами React; onSubmit у OpenTUI отдаёт строку.
          onSubmit={handleSubmit as never}
        />
      </box>

      {/* Футер: режим слева, статус справа */}
      <box height={1} flexDirection="row" justifyContent="space-between" paddingLeft={1} paddingRight={1}>
        <text fg={m.color}>
          {glyph.hammerSickle} {m.title} <span fg={theme.muted}>— {m.hint} · Shift+Tab</span>
        </text>
        {musicOn && player.playing ? (
          <text fg={theme.gold}>♪ Гимн — Esc, чтобы выключить</text>
        ) : busySince != null ? (
          <text fg={theme.accent}>
            {frame} трудимся… {seconds}с <span fg={theme.muted}>· Esc — прервать</span>
          </text>
        ) : (
          <text fg={theme.muted}>К труду готова {glyph.hammerSickle}</text>
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
      <box flexDirection="row" paddingTop={0} marginTop={0}>
        <text fg={color}>
          {"  "}{glyph.branch} {mark} {toolLabel(item.tool)}
          {item.title ? ` — ${item.title}` : ""}
        </text>
      </box>
    )
  }
  if (item.kind === "system") {
    return (
      <box flexDirection="column" paddingTop={1}>
        {item.text.split("\n").map((ln, i) => (
          <text key={i} fg={theme.gold}>
            {ln}
          </text>
        ))}
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

// Лёгкая проза: заголовки, списки, обычные строки. Без вложенных <b> —
// они ломали layout в реальном терминале (строки накладывались).
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
              § {inlineClean(heading[2])}
            </text>
          )
        const li = /^\s*[-*]\s+(.*)$/.exec(ln)
        if (li)
          return (
            <text key={i}>
              {"  "}{glyph.arrow} {inlineClean(li[1])}
            </text>
          )
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
