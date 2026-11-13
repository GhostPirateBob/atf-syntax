// Files the user drops or picks, sorted into playlists and audio. The browser gives a page file
// names, plus the path below a picked or dropped folder, but never the full path on disk.
import { isAudioName, isPlaylistName } from './audio'
import { parseM3u, type PlaylistEntry } from './m3u'

/** An audio file and what the page knows of its location: a relative path or the bare name. */
export interface PickedFile {
  file: File
  path: string
}

/** What a drop or pick brought: playlist entries (if there was a playlist) and audio files. */
export interface Picked {
  entries?: PlaylistEntry[]
  audio: PickedFile[]
}

const fileOf = (entry: FileSystemFileEntry) => new Promise<File>((resolve, reject) => entry.file(resolve, reject))

/** Audio and playlist files below a dropped entry, walking into folders. Other files are skipped. */
async function walk(entry: FileSystemEntry, out: PickedFile[]): Promise<void> {
  if (entry.isFile) {
    if (isAudioName(entry.name) || isPlaylistName(entry.name)) {
      out.push({ file: await fileOf(entry as FileSystemFileEntry), path: entry.fullPath.replace(/^\/+/, '') })
    }
  } else if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader()
    // readEntries hands back a folder in batches; an empty batch means done.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
      if (!batch.length) break
      for (const child of batch) await walk(child, out)
    }
  }
}

/** Files from a drop, folders included. Call it synchronously in the drop handler: the list empties after. */
export function filesFromDrop(data: DataTransfer): Promise<PickedFile[]> {
  const entries = [...data.items].filter((i) => i.kind === 'file').map((i) => i.webkitGetAsEntry?.())
  if (entries.length && entries.every((e) => e)) {
    return (async () => {
      const out: PickedFile[] = []
      for (const e of entries) await walk(e!, out)
      return out
    })()
  }
  return Promise.resolve([...data.files].map((file) => ({ file, path: file.name })))
}

/** Files from an `<input type="file">`, with the folder path when a folder was picked. */
export function filesFromInput(list: FileList | null): PickedFile[] {
  return [...(list ?? [])].map((file) => ({ file, path: file.webkitRelativePath || file.name }))
}

/** Sorts files into playlist entries (all playlists, in order) and audio files. Other files are dropped. */
export async function sortPicked(files: PickedFile[]): Promise<Picked> {
  const playlists = files.filter((f) => isPlaylistName(f.path))
  const audio = files.filter((f) => isAudioName(f.path))
  if (!playlists.length) return { audio }
  const texts = await Promise.all(playlists.map((p) => p.file.text()))
  return { entries: texts.flatMap(parseM3u), audio }
}
