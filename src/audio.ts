import { spawn, type ChildProcess } from "node:child_process"
import { existsSync } from "node:fs"

export interface Player {
  readonly playing: boolean
  stop(): void
}

// Проигрываем mp3 системным плеером (afplay в macOS, ffplay/mpg123 в Linux)
// и убиваем процесс по скипу. Всё не критично: нет файла/плеера — просто тишина.
export function playAudio(file: string): Player {
  let proc: ChildProcess | null = null
  let playing = false

  if (existsSync(file) && process.env.ZAREKA_NO_ANTHEM !== "1") {
    const [cmd, args] = pickPlayer(file)
    try {
      proc = spawn(cmd, args, { stdio: "ignore" })
      playing = true
      const clear = () => {
        playing = false
        proc = null
      }
      proc.on("exit", clear)
      proc.on("error", clear) // плеер не найден — молча гасим
    } catch {
      proc = null
      playing = false
    }
  }

  return {
    get playing() {
      return playing
    },
    stop() {
      if (proc) {
        try {
          proc.kill("SIGTERM")
        } catch {
          // процесс мог уже завершиться
        }
        proc = null
      }
      playing = false
    },
  }
}

function pickPlayer(file: string): [string, string[]] {
  if (process.platform === "darwin") return ["afplay", [file]]
  if (process.platform === "win32")
    return ["powershell", ["-c", `(New-Object Media.SoundPlayer '${file}').PlaySync()`]]
  // Linux и прочее: пробуем ffplay (часть ffmpeg); если нет — сработает on("error").
  return ["ffplay", ["-nodisp", "-autoexit", "-loglevel", "quiet", file]]
}
