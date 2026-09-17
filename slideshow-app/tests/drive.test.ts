import { describe, expect, it } from 'vitest'
import { parseFolderId } from '../src/main/google/drive'

describe('parseFolderId', () => {
  it('extracts the id from a standard folder URL', () => {
    expect(parseFolderId('https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp')).toBe(
      '1AbCdEfGhIjKlMnOp'
    )
  })

  it('extracts the id from a URL with query params after the id', () => {
    expect(parseFolderId('https://drive.google.com/drive/folders/1AbCdEfGh?usp=sharing')).toBe(
      '1AbCdEfGh'
    )
  })

  it('extracts the id from an ?id= style URL', () => {
    expect(parseFolderId('https://drive.google.com/open?id=1AbCdEfGh')).toBe('1AbCdEfGh')
  })

  it('accepts a raw folder id', () => {
    expect(parseFolderId('1AbCdEfGhIjKlMnOp')).toBe('1AbCdEfGhIjKlMnOp')
  })

  it('rejects garbage input', () => {
    expect(() => parseFolderId('not a valid folder reference!!')).toThrow()
  })
})
