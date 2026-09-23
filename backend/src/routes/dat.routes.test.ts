import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../app.js'
import {
  importDatFile,
  getDatCatalog,
  deleteDatFile,
} from '../service/dat-import.service.js'

// Mocks the necessary functions for testing
vi.mock('../service/dat-import.service.js', () => ({
  importDatFile: vi.fn(),
  getDatCatalog: vi.fn(),
  deleteDatFile: vi.fn(),
}))

// Tests for the .dat catalog endpoints, through the real Express app
describe('dat routes', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  describe('GET /dat', () => {
    it('must return the dat catalog wrapped in a data key', async () => {
      vi.mocked(getDatCatalog).mockResolvedValue([{ id: 'dat-1' }] as never)

      const response = await request(createApp()).get('/api/dat')

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ data: [{ id: 'dat-1' }] })
    })
  })

  describe('POST /dat/import', () => {
    it('must reject a request with a missing fileName', async () => {
      const response = await request(createApp())
        .post('/api/dat/import')
        .send({})

      expect(response.status).toBe(400)
      expect(importDatFile).not.toHaveBeenCalled()
    })

    it('must reject a request with an empty fileName', async () => {
      const response = await request(createApp())
        .post('/api/dat/import')
        .send({ fileName: '' })

      expect(response.status).toBe(400)
      expect(importDatFile).not.toHaveBeenCalled()
    })

    it('must call importDatFile and return 201 with the result', async () => {
      vi.mocked(importDatFile).mockResolvedValue({
        datFile: { id: 'dat-1' },
        insertedEntries: 2,
      } as never)

      const response = await request(createApp())
        .post('/api/dat/import')
        .send({ fileName: 'snes.dat' })

      expect(response.status).toBe(201)
      expect(importDatFile).toHaveBeenCalledWith('snes.dat')
      expect(response.body).toEqual({
        datFile: { id: 'dat-1' },
        insertedEntries: 2,
      })
    })
  })

  describe('DELETE /dat/:id', () => {
    it('must reject an invalid id (not a uuid)', async () => {
      const response = await request(createApp()).delete('/api/dat/not-a-uuid')

      expect(response.status).toBe(400)
      expect(deleteDatFile).not.toHaveBeenCalled()
    })

    it('must call deleteDatFile and return 204 with no body', async () => {
      vi.mocked(deleteDatFile).mockResolvedValue({ id: 'dat-1' } as never)

      const id = '123e4567-e89b-12d3-a456-426614174000'
      const response = await request(createApp()).delete(`/api/dat/${id}`)

      expect(response.status).toBe(204)
      expect(deleteDatFile).toHaveBeenCalledWith(id)
    })
  })
})
