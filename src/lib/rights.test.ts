import { describe, expect, it } from 'vitest'
import { canModify } from './rights'

describe('canModify', () => {
  it('автор может', () => expect(canModify({ created_by: 'a' }, 'a')).toBe(true))
  it('другой участник не может', () => expect(canModify({ created_by: 'a' }, 'b')).toBe(false))
  it('запись из своей очереди — можно', () => expect(canModify({ pending: true }, 'b')).toBe(true))
  it('без автора или без входа — нельзя', () => {
    expect(canModify({}, 'a')).toBe(false)
    expect(canModify({ created_by: '' }, '')).toBe(false)
  })
})
