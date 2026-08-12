import { supabase } from './supabaseClient'

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? ''

export class ApiError extends Error {
  readonly status: number
  readonly code?: string

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

/**
 * Backend fetch wrapper: attaches the Supabase JWT (verified by
 * middleware/auth.ts) and normalizes { error, code } responses into ApiError.
 */
async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session?.access_token) throw new ApiError('You are not signed in', 401, 'NO_SESSION')

  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError('Could not reach the API server', 0, 'NETWORK')
  }

  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok) {
    throw new ApiError(
      typeof json.error === 'string' ? json.error : `Request failed (${response.status})`,
      response.status,
      typeof json.code === 'string' ? json.code : undefined,
    )
  }
  return json as T
}

export const apiRequest = request
export const apiGet = <T>(path: string) => request<T>('GET', path)
export const apiPost = <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {})
export const apiDelete = <T>(path: string) => request<T>('DELETE', path)
