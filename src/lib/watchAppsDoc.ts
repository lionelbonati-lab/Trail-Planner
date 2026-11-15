// Contenu du cadre « Applications Garmin » (onglet Montre), lu dans public/montre/applications.md :
// un fichier Markdown simple que le propriétaire modifie directement sur GitHub (textes, liens du
// Connect IQ Store, captures d'écran de la montre), sans toucher au code.

/** Morceau de texte : simple, gras, lien ou image. */
export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'link'; text: string; href: string }
  | { kind: 'image'; alt: string; src: string }

export type Block = { kind: 'p'; parts: Inline[] } | { kind: 'list'; items: Inline[][] }

export interface DocApp {
  name: string
  type: string
  /** Lien du Connect IQ Store, ou null si l'application n'y est pas encore. */
  store: string | null
  /** Capture de l'écran de la montre (nom de fichier du dossier, ou lien). */
  image: string | null
  guide: string | null
  body: Block[]
}

export interface WatchAppsDoc {
  intro: Block[]
  apps: DocApp[]
}

const FIELD = /^(type|store|image|guide)\s*:\s*(.*)$/i

/** Gras, liens et images dans une ligne de texte. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = []
  const re = /!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*/g
  let last = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ kind: 'text', text: text.slice(last, m.index) })
    if (m[2] !== undefined) out.push({ kind: 'image', alt: m[1], src: m[2] })
    else if (m[4] !== undefined) out.push({ kind: 'link', text: m[3], href: m[4] })
    else out.push({ kind: 'bold', text: m[5] })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) })
  return out
}

/** Paragraphes (lignes consécutives) et listes « - » / « * ». */
function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = []
  let para: string[] = []
  let list: string[] = []
  const flush = () => {
    if (para.length) blocks.push({ kind: 'p', parts: parseInline(para.join(' ')) })
    if (list.length) blocks.push({ kind: 'list', items: list.map(parseInline) })
    para = []
    list = []
  }
  for (const raw of lines) {
    const line = raw.trim()
    const item = /^[-*]\s+(.*)$/.exec(line)
    if (!line) flush()
    else if (item) {
      if (para.length) flush()
      list.push(item[1])
    } else {
      if (list.length) flush()
      para.push(line)
    }
  }
  flush()
  return blocks
}

/** Lit le fichier : introduction, puis une application par titre « ## ». */
export function parseWatchAppsDoc(md: string): WatchAppsDoc {
  const lines = md.replace(/<!--[\s\S]*?-->/g, '').replace(/\r/g, '').split('\n')
  const intro: string[] = []
  const apps: { name: string; fields: Record<string, string>; body: string[]; inBody: boolean }[] = []
  for (const line of lines) {
    const h = /^##\s+(.+)$/.exec(line.trim())
    if (h) {
      apps.push({ name: h[1].trim(), fields: {}, body: [], inBody: false })
      continue
    }
    const cur = apps[apps.length - 1]
    if (!cur) {
      if (!/^#\s/.test(line.trim())) intro.push(line)
      continue
    }
    // Champs juste sous le titre : jusqu'à la première ligne de texte, ou la ligne vide qui les suit.
    const f = cur.inBody ? null : FIELD.exec(line.trim())
    if (f) cur.fields[f[1].toLowerCase()] = f[2].trim()
    else {
      if (line.trim() || Object.keys(cur.fields).length) cur.inBody = true
      cur.body.push(line)
    }
  }
  return {
    intro: parseBlocks(intro),
    apps: apps.map((a) => ({
      name: a.name,
      type: a.fields.type ?? '',
      store: a.fields.store || null,
      image: a.fields.image || null,
      guide: a.fields.guide || null,
      body: parseBlocks(a.body),
    })),
  }
}

/** Paragraphe fait seulement d'images (une ou plusieurs lignes à la suite) : affiché en galerie qui défile. */
export function galleryImages(b: Block): { alt: string; src: string }[] | null {
  if (b.kind !== 'p') return null
  const images = b.parts.flatMap((p) => (p.kind === 'image' ? [{ alt: p.alt, src: p.src }] : []))
  const onlyImages = b.parts.every((p) => p.kind === 'image' || (p.kind === 'text' && !p.text.trim()))
  return images.length && onlyImages ? images : null
}

/** Adresse d'une image ou d'un lien du fichier : relative au dossier montre/ du site, sauf lien complet. */
export function docUrl(src: string, base: string): string {
  return /^(https?:)?\/\//.test(src) || src.startsWith('/') ? src : `${base}montre/${src.replace(/^\.\//, '')}`
}
