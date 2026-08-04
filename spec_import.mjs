// Импорт функциональной спеки РААН (spec/*.md репозитория meta-bpm) в Huly.
//
// Общий, не как raan_import.mjs с зашитым текстом: содержимое читается с диска,
// поэтому 780 КБ не проходят через чужой контекст и правки в git приезжают сюда
// повторным запуском.
//
// Идемпотентность по заголовку: документ с таким же title в пространстве
// обновляется, а не создаётся вторым. Значит скрипт можно гонять после каждого
// изменения спеки.
//
//   TEAMSPACE=<id> SPEC_DIR=<путь> node spec_import.mjs
//   ONLY=01-PROCESS,05-STORAGE ...   — залить только названные файлы

import { readFileSync, readdirSync } from "node:fs"
import { join, basename } from "node:path"
import { WebSocket } from "ws"; globalThis.WebSocket = WebSocket
// Клиент Huly рассчитан на браузер: вешает beforeunload на window. В Node его нет,
// и без заглушки connect падает ещё до сети (ReferenceError: window is not defined).
globalThis.window ??= { addEventListener() {}, removeEventListener() {}, location: { href: "" } }
import api from "@hcengineering/api-client"
import documentMod from "@hcengineering/document"
import coreCJS from "@hcengineering/core"

const connect = api.connect ?? api.default.connect
const document = documentMod.default ?? documentMod
const generateId = coreCJS.generateId

const TS = process.env.TEAMSPACE
const SPEC_DIR = process.env.SPEC_DIR
if (!TS || !SPEC_DIR) { console.error("нужны TEAMSPACE и SPEC_DIR"); process.exit(1) }
const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : null

// Доступ берём из конфига Claude Desktop — отдельного файла с секретами не заводим.
const cfgPath = process.env.HOME + "/Library/Application Support/Claude/claude_desktop_config.json"
const env = JSON.parse(readFileSync(cfgPath, "utf8")).mcpServers?.huly?.env ?? {}
const TOKEN = process.env.HULY_TOKEN ?? env.HULY_TOKEN
const WS = process.env.HULY_WORKSPACE ?? env.HULY_WORKSPACE
// accounts-URL вида https://host/_accounts → базовый https://host
const URL_ = (process.env.HULY_FRONT_URL ?? env.HULY_FRONT_URL ?? (env.HULY_ACCOUNTS_URL ?? "").replace(/\/_accounts$/, ""))
if (!TOKEN || !WS || !URL_) { console.error("не нашёл доступ в конфиге Claude Desktop"); process.exit(1) }

// Заголовок документа: «01. Процесс, роли, очереди» из первой строки файла и номера.
function titleOf(file, md) {
  const h1 = (md.match(/^#\s+(.+)$/m) || [])[1]?.trim()
  const num = basename(file).match(/^(\d+)-/)?.[1]
  if (basename(file) === "README.md") return "Спецификация РААН — карта и конвенция"
  return num ? `${num}. ${h1 ?? basename(file)}` : (h1 ?? basename(file))
}

const client = await connect(URL_, { token: TOKEN, workspace: WS })
try {
  const existing = await client.findAll(document.class.Document, { space: TS })
  const byTitle = new Map(existing.map(d => [d.title, d]))
  console.log(`в пространстве уже документов: ${existing.length}`)

  const files = readdirSync(SPEC_DIR)
    .filter(f => f.endsWith(".md"))
    .sort((a, b) => (a === "README.md" ? -1 : b === "README.md" ? 1 : a.localeCompare(b)))

  // README становится корнем, остальные — его детьми: в Huly дерево читается
  // сверху вниз, и карта спеки должна быть входом, а не файлом в общем списке.
  let rootId = null
  for (const f of files) {
    const short = basename(f, ".md")
    if (ONLY && !ONLY.includes(short) && short !== "README") continue
    const md = readFileSync(join(SPEC_DIR, f), "utf8")
    const title = titleOf(f, md)
    const isRoot = f === "README.md"
    const prev = byTitle.get(title)

    if (prev) {
      const ref = await client.uploadMarkup(document.class.Document, prev._id, "content", md, "markdown")
      await client.updateDoc(document.class.Document, TS, prev._id, { content: ref })
      if (isRoot) rootId = prev._id
      console.log(`  ~ обновлён: ${title}`)
    } else {
      const id = generateId()
      const ref = await client.uploadMarkup(document.class.Document, id, "content", md, "markdown")
      await client.createDoc(document.class.Document, TS, {
        title,
        parent: isRoot ? document.ids.NoParent : (rootId ?? document.ids.NoParent),
        content: ref
      }, id)
      if (isRoot) rootId = id
      console.log(`  + создан:   ${title}`)
    }
  }
  console.log("готово")
} finally {
  await client.close()
}
