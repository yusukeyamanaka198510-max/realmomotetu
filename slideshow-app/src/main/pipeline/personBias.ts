import type { MediaItem } from '@shared/types'

/** An anonymous per-photo person cluster id, e.g. "person_a". Cluster
 * identity is stable only within a single job run -- there is no attempt
 * to recognize *who* appears, only to notice "this looks like the same
 * face as that other photo" for appearance-count balancing. */
export type ClusterId = string

export interface PersonTag {
  mediaItemId: string
  clusterIds: ClusterId[]
}

/** First-implementation interface only (per spec): a real implementation
 * would run face-embedding extraction + clustering (e.g. via the Python/
 * OpenCV side-channel already used for face-aware cropping) and assign
 * stable anonymous cluster ids across the whole batch. */
export interface PersonTagger {
  tagAll(items: readonly MediaItem[]): Promise<Map<string, PersonTag>>
}

/** Always reports "no person information available". This is the only
 * implementation wired up in the MVP; `personBiasMode: 'balance'` is
 * accepted by the UI/settings but currently behaves identically to `off`
 * until a real `PersonTagger` (face-embedding clustering) replaces this. */
export class NoOpPersonTagger implements PersonTagger {
  async tagAll(items: readonly MediaItem[]): Promise<Map<string, PersonTag>> {
    const map = new Map<string, PersonTag>()
    for (const item of items) {
      map.set(item.id, { mediaItemId: item.id, clusterIds: [] })
    }
    return map
  }
}

/** Reorders `items` to avoid runs of the same person cluster appearing too
 * close together, and to roughly even out each cluster's total screen
 * time. With `NoOpPersonTagger` every item has zero cluster ids, so this
 * is a no-op and the seeded shuffle order from rng.ts is preserved --
 * exactly the "interface only" first implementation the spec asks for. */
export function reorderByPersonBias(
  items: readonly MediaItem[],
  tags: ReadonlyMap<string, PersonTag>
): MediaItem[] {
  const hasAnyClusterInfo = items.some((item) => (tags.get(item.id)?.clusterIds.length ?? 0) > 0)
  if (!hasAnyClusterInfo) {
    return items.slice()
  }

  // Placeholder for the future clustering-aware reorder: a simple greedy
  // pass that avoids placing two items sharing a cluster id adjacently
  // when an alternative exists.
  const remaining = items.slice()
  const result: MediaItem[] = []
  let lastClusters = new Set<ClusterId>()
  while (remaining.length > 0) {
    let pickIndex = remaining.findIndex((item) => {
      const clusters = tags.get(item.id)?.clusterIds ?? []
      return !clusters.some((c) => lastClusters.has(c))
    })
    if (pickIndex === -1) pickIndex = 0
    const [picked] = remaining.splice(pickIndex, 1)
    result.push(picked)
    lastClusters = new Set(tags.get(picked.id)?.clusterIds ?? [])
  }
  return result
}
