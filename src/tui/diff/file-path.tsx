// Port of the reference FilePath (opencode v2.0.6 packages/tui/src/ui/
// file-path.tsx): render a path with the directories muted and the basename
// bright, truncating middle segments first ("…/seg/name.ext") and keeping
// the extension when the basename itself must shrink. The two-tone row is
// rendered as a flex row of two texts (our React binding has no styled
// span runs inside one text).

import { stringWidth } from "./string-width"

export interface FilePathProps {
  value: string
  maxWidth: number
  fg?: string
  basenameFg?: string
}

export function FilePath(props: FilePathProps) {
  const display = truncateFilePath(props.value, props.maxWidth)
  const index = Math.max(display.lastIndexOf("/"), display.lastIndexOf("\\"))
  const parent = display.slice(0, index + 1)
  const basename = display.slice(index + 1)
  return (
    <box style={{ flexDirection: "row", flexShrink: 0, minWidth: 0 }}>
      <text content={parent} fg={props.fg} wrapMode="none" />
      <text content={basename} fg={props.basenameFg ?? props.fg} wrapMode="none" />
    </box>
  )
}

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })

export function truncateFilePath(value: string, maxWidth: number) {
  if (maxWidth <= 0) return ""
  if (stringWidth(value) <= maxWidth) return value

  const drive = value.match(/^([A-Za-z]:)([\\/])/)
  const unc = value.match(/^(\\\\|\/\/)([^\\/]+)[\\/]([^\\/]+)(?:[\\/]|$)/)
  const windows = drive !== null || unc !== null || (!value.includes("/") && value.includes("\\"))
  const separator = drive?.[2] ?? (unc?.[1] === "//" ? "/" : windows ? "\\" : "/")
  const root = drive
    ? drive[1] + separator
    : unc
      ? unc[1] + unc[2] + separator + unc[3] + separator
      : value.startsWith("/")
        ? "/"
        : ""
  const source = value.slice(drive?.[0].length ?? unc?.[0].length ?? root.length)
  const segments = source.split(windows ? /[\\/]/ : separator).filter(Boolean)
  const basename = segments.at(-1) ?? value
  if (segments.length < 2) {
    const rootWidth = stringWidth(root)
    if (rootWidth >= maxWidth) return takeStart(root, maxWidth)
    return root + truncateBasename(basename, maxWidth - rootWidth)
  }

  const prefix = `${root}…${separator}`
  const basenameWidth = maxWidth - stringWidth(prefix)
  if (basenameWidth <= 0) return takeStart(prefix, maxWidth)
  const compact = truncateBasename(basename, basenameWidth)
  if (compact !== basename) return prefix + compact

  const selected = [basename]
  const separatorWidth = stringWidth(separator)
  let width = stringWidth(prefix + basename)
  for (let index = segments.length - 2; index >= 0; index--) {
    const segment = segments[index]!
    const next = stringWidth(segment) + separatorWidth
    if (width + next > maxWidth) {
      const available = maxWidth - width - separatorWidth
      if (available > 1) selected.unshift(takeStart(segment, available - 1) + "…")
      break
    }
    selected.unshift(segment)
    width += next
  }
  return prefix + selected.join(separator)
}

function truncateBasename(value: string, maxWidth: number) {
  if (stringWidth(value) <= maxWidth) return value
  if (maxWidth <= 1) return takeStart("…", maxWidth)

  const dot = value.lastIndexOf(".")
  const extension = dot > 0 ? value.slice(dot) : ""
  const extensionWidth = stringWidth(extension)
  if (extensionWidth >= maxWidth) return "…" + takeEnd(extension, maxWidth - 1)

  const stem = extension ? value.slice(0, dot) : value
  return takeStart(stem, maxWidth - extensionWidth - 1) + "…" + extension
}

function takeStart(value: string, maxWidth: number) {
  return take(value, maxWidth, false)
}

function takeEnd(value: string, maxWidth: number) {
  return take(value, maxWidth, true)
}

function take(value: string, maxWidth: number, reverse: boolean) {
  const segments = Array.from(graphemeSegmenter.segment(value), (item) => item.segment)
  if (reverse) segments.reverse()
  const selected: string[] = []
  let width = 0
  for (const segment of segments) {
    const next = stringWidth(segment)
    if (width + next > maxWidth) break
    selected.push(segment)
    width += next
  }
  if (reverse) selected.reverse()
  return selected.join("")
}
