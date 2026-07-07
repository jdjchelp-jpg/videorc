import { describe, expect, it } from 'vitest'

import type { LiveChatMessage, LiveChatProviderState, StreamPlatform } from '@/lib/backend'
import {
  applyLiveChatCleared,
  applyLiveChatMessage,
  applyLiveChatMessages,
  applyLiveChatProviderStatus,
  emptyLiveChatSnapshot,
  filterMessagesByPlatform,
  liveChatEmptyMessage,
  nextUnreadCount,
  shouldAutoscroll,
  sortMessagesChronological,
  visibleMessages
} from './live-chat-view'

function message(id: string, platform: StreamPlatform, receivedAt: string): LiveChatMessage {
  return {
    id,
    providerMessageId: id,
    platform,
    sessionId: 's1',
    authorName: 'Viewer',
    authorBadges: [],
    authorRoles: [],
    publishedAt: receivedAt,
    receivedAt,
    messageText: 'hi',
    fragments: [],
    eventType: 'message',
    isDeleted: false
  }
}

function provider(platform: StreamPlatform, message: string): LiveChatProviderState {
  return { platform, state: 'connected', message, capabilities: [] }
}

describe('live-chat-view', () => {
  it('sorts messages chronologically by receivedAt', () => {
    const sorted = sortMessagesChronological([
      message('twitch:b', 'twitch', '2026-06-06T10:00:02Z'),
      message('youtube:a', 'youtube', '2026-06-06T10:00:01Z'),
      message('twitch:c', 'twitch', '2026-06-06T10:00:03Z')
    ])
    expect(sorted.map((m) => m.id)).toEqual(['youtube:a', 'twitch:b', 'twitch:c'])
  })

  it('merges an out-of-order message into chronological position', () => {
    let snapshot = emptyLiveChatSnapshot('now')
    snapshot = applyLiveChatMessage(snapshot, message('a', 'youtube', '2026-06-06T10:00:03Z'))
    snapshot = applyLiveChatMessage(snapshot, message('b', 'twitch', '2026-06-06T10:00:01Z'))
    expect(snapshot.messages.map((m) => m.id)).toEqual(['b', 'a'])
  })

  it('dedupes incremental messages by id', () => {
    let snapshot = emptyLiveChatSnapshot('now')
    const duplicate = message('dup', 'youtube', '2026-06-06T10:00:01Z')
    snapshot = applyLiveChatMessage(snapshot, duplicate)
    snapshot = applyLiveChatMessage(snapshot, duplicate)
    expect(snapshot.messages).toHaveLength(1)
  })

  it('filters by platform, treating an empty set as show-all', () => {
    const messages = [
      message('y', 'youtube', '2026-06-06T10:00:01Z'),
      message('t', 'twitch', '2026-06-06T10:00:02Z')
    ]
    expect(filterMessagesByPlatform(messages, new Set()).map((m) => m.id)).toEqual(['y', 't'])
    expect(
      filterMessagesByPlatform(messages, new Set<StreamPlatform>(['twitch'])).map((m) => m.id)
    ).toEqual(['t'])
  })

  it('updates an existing provider row and appends new ones', () => {
    let snapshot = emptyLiveChatSnapshot('now')
    snapshot = applyLiveChatProviderStatus(snapshot, provider('youtube', 'connecting'))
    snapshot = applyLiveChatProviderStatus(snapshot, provider('twitch', 'connected'))
    snapshot = applyLiveChatProviderStatus(snapshot, provider('youtube', 'connected'))
    expect(snapshot.providers).toHaveLength(2)
    expect(snapshot.providers.find((p) => p.platform === 'youtube')?.message).toBe('connected')
  })

  it('clears the message view but keeps providers', () => {
    let snapshot = emptyLiveChatSnapshot('now')
    snapshot = applyLiveChatProviderStatus(snapshot, provider('youtube', 'connected'))
    snapshot = applyLiveChatMessage(snapshot, message('a', 'youtube', '2026-06-06T10:00:01Z'))
    snapshot = applyLiveChatCleared(snapshot)
    expect(snapshot.messages).toHaveLength(0)
    expect(snapshot.unreadCount).toBe(0)
    expect(snapshot.providers).toHaveLength(1)
  })

  it('counts unread only while paused, and autoscrolls only when not paused', () => {
    expect(nextUnreadCount(0, false, 3)).toBe(0)
    expect(nextUnreadCount(2, true, 3)).toBe(5)
    expect(shouldAutoscroll(false)).toBe(true)
    expect(shouldAutoscroll(true)).toBe(false)
  })

  it('applies a batch of messages in one pass, deduped and ordered', () => {
    let snapshot = emptyLiveChatSnapshot('now')
    snapshot = applyLiveChatMessage(snapshot, message('a', 'youtube', '2026-06-06T10:00:02Z'))
    snapshot = applyLiveChatMessages(snapshot, [
      message('b', 'twitch', '2026-06-06T10:00:01Z'),
      message('a', 'youtube', '2026-06-06T10:00:02Z'),
      message('c', 'twitch', '2026-06-06T10:00:03Z')
    ])
    expect(snapshot.messages.map((m) => m.id)).toEqual(['b', 'a', 'c'])
  })

  it('windows the rendered tail to the most recent messages', () => {
    const messages = Array.from({ length: 5 }, (_, index) =>
      message(`m${index}`, 'youtube', `2026-06-06T10:00:0${index}Z`)
    )
    expect(visibleMessages(messages, 2).map((m) => m.id)).toEqual(['m3', 'm4'])
    expect(visibleMessages(messages, 10)).toHaveLength(5)
  })

  it('uses actionable provider messages for the empty state', () => {
    expect(liveChatEmptyMessage({ providers: [] })).toBe(
      'Connect YouTube or Twitch to read live comments.'
    )
    expect(
      liveChatEmptyMessage({
        providers: [
          {
            platform: 'twitch',
            state: 'disabled',
            message: 'Connect Twitch to read live comments.',
            capabilities: ['not-connected']
          }
        ]
      })
    ).toBe('Connect Twitch to read live comments.')
    expect(
      liveChatEmptyMessage({
        providers: [
          {
            platform: 'twitch',
            state: 'disabled',
            message: 'Reconnect Twitch to enable live comments.',
            capabilities: ['needs-reconnect']
          }
        ]
      })
    ).toBe('Reconnect Twitch to enable live comments.')
    expect(
      liveChatEmptyMessage({
        providers: [
          {
            platform: 'twitch',
            state: 'connected',
            message: 'Twitch live chat connected.',
            capabilities: ['available']
          }
        ]
      })
    ).toBe('No comments yet. Comments appear here once you go live.')
  })
})
