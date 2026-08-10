import { createAngelOneAdapter, AngelOneAdapter } from './angelOneService'
import type { BrokerAdapter, BrokerId, BrokerSession, SessionPersistence } from './types'

export * from './types'
export { AngelOneAdapter, createAngelOneAdapter }

/**
 * Multi-broker factory (spec 3.2 future-proofing). Everything above this
 * layer only depends on BrokerAdapter; adding broker #2 = a new folder + one
 * switch case here.
 */
export function createBrokerAdapter(
  broker: BrokerId,
  connectionId: string,
  persistence?: SessionPersistence,
): BrokerAdapter {
  switch (broker) {
    case 'angelone':
      return createAngelOneAdapter(connectionId, persistence)
    default: {
      const exhaustive: never = broker
      throw new Error(`Unsupported broker: ${exhaustive as string}`)
    }
  }
}

/**
 * Process-local registry of live adapters, keyed by broker_connections.id.
 * The HTTP routes (next milestone) and the token-refresh job share this so a
 * user's SmartAPI session is created once per process and reused.
 */
class AdapterRegistry {
  private adapters = new Map<string, BrokerAdapter>()

  get(connectionId: string): BrokerAdapter | undefined {
    return this.adapters.get(connectionId)
  }

  getOrCreate(broker: BrokerId, connectionId: string, persistence?: SessionPersistence): BrokerAdapter {
    const existing = this.adapters.get(connectionId)
    if (existing) return existing
    const adapter = createBrokerAdapter(broker, connectionId, persistence)
    this.adapters.set(connectionId, adapter)
    return adapter
  }

  /** Attach a session restored from the DB (e.g. after a backend restart). */
  restore(broker: BrokerId, connectionId: string, session: BrokerSession, persistence?: SessionPersistence): BrokerAdapter {
    const adapter = this.getOrCreate(broker, connectionId, persistence)
    adapter.useSession(session)
    return adapter
  }

  evict(connectionId: string): void {
    this.adapters.delete(connectionId)
  }
}

export const adapterRegistry = new AdapterRegistry()
