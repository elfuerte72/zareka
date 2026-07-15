import {
  BoxRenderable,
  InputRenderable,
  InputRenderableEvents,
  ScrollBoxRenderable,
  TextRenderable,
  createCliRenderer,
  type CliRenderer,
} from "@opentui/core"

const COLORS = {
  accent: "#7aa2f7",
  user: "#e0af68",
  agent: "#c0caf5",
  tool: "#565f89",
  status: "#9ece6a",
  error: "#f7768e",
}

export class ZarekaUI {
  private renderer!: CliRenderer
  private log!: ScrollBoxRenderable
  private input!: InputRenderable
  private status!: TextRenderable
  private parts = new Map<string, TextRenderable>()
  private counter = 0

  static async create(modelLabel: string, onSubmit: (text: string) => void): Promise<ZarekaUI> {
    const ui = new ZarekaUI()
    const renderer = await createCliRenderer()
    ui.renderer = renderer

    const root = new BoxRenderable(renderer, {
      id: "root",
      flexDirection: "column",
      width: "100%",
      height: "100%",
    })

    const header = new BoxRenderable(renderer, {
      id: "header",
      width: "100%",
      height: 3,
      border: true,
      borderColor: COLORS.accent,
      title: " Зарека ",
      titleAlignment: "left",
      paddingLeft: 1,
    })
    header.add(
      new TextRenderable(renderer, {
        id: "model",
        content: `модель: ${modelLabel}`,
        fg: COLORS.tool,
      }),
    )

    ui.log = new ScrollBoxRenderable(renderer, {
      id: "log",
      width: "100%",
      flexGrow: 1,
      paddingLeft: 1,
      paddingRight: 1,
    })

    const inputBox = new BoxRenderable(renderer, {
      id: "input-box",
      width: "100%",
      height: 3,
      border: true,
      borderColor: COLORS.accent,
    })
    ui.input = new InputRenderable(renderer, {
      id: "input",
      width: "100%",
      placeholder: "Спросите Зареку… (Enter — отправить, Ctrl+C — выход)",
    })
    inputBox.add(ui.input)

    ui.status = new TextRenderable(renderer, {
      id: "status",
      content: "Готова",
      fg: COLORS.status,
      width: "100%",
    })

    root.add(header)
    root.add(ui.log)
    root.add(inputBox)
    root.add(ui.status)
    renderer.root.add(root)

    const submitEvent = (InputRenderableEvents as Record<string, string>).ENTER ?? "enter"
    ui.input.on(submitEvent, () => {
      const text = ui.input.value.trim()
      if (!text) return
      ui.input.value = ""
      onSubmit(text)
    })
    ui.input.focus()
    return ui
  }

  addUser(text: string) {
    this.append(`Вы: ${text}`, COLORS.user)
  }

  addSystem(text: string) {
    this.append(text, COLORS.tool)
  }

  addError(text: string) {
    this.append(`Ошибка: ${text}`, COLORS.error)
  }

  // Стриминговые части ответа: одна и та же часть обновляется по ключу.
  upsertPart(key: string, text: string, kind: "text" | "tool") {
    const existing = this.parts.get(key)
    const color = kind === "tool" ? COLORS.tool : COLORS.agent
    if (existing) {
      existing.content = text
    } else {
      this.parts.set(key, this.append(text, color))
    }
    this.scrollToBottom()
  }

  setStatus(text: string) {
    this.status.content = text
  }

  private append(content: string, fg: string): TextRenderable {
    const item = new TextRenderable(this.renderer, {
      id: `line-${this.counter++}`,
      content,
      fg,
      width: "100%",
    })
    this.log.add(item)
    this.scrollToBottom()
    return item
  }

  private scrollToBottom() {
    try {
      ;(this.log as unknown as { scrollTop: number }).scrollTop = Number.MAX_SAFE_INTEGER
    } catch {
      // прокрутка — не критична
    }
  }
}
