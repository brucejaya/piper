import { randomUUID } from "node:crypto";
import DHT from "hyperdht";
import type { Allowlist } from "./allowlist.js";
import { createLineDecoder, encode, shortKey, type InboundMessage, type OutboundMessage } from "./protocol.js";

/** A connected, allowlisted manager. */
export interface Peer {
  id: string;
  remoteKey: string;
  send(msg: OutboundMessage): void;
}

export interface TransportHandlers {
  onConnect(peer: Peer): void;
  onMessage(peer: Peer, msg: InboundMessage): void;
  onDisconnect(peer: Peer): void;
  log(line: string): void;
}

/**
 * Owns the HyperDHT node + server, gates incoming connections against the
 * allowlist, and exposes a simple per-peer send / broadcast surface.
 *
 * `dhtOptions` is threaded through to `new DHT(...)` so tests can point at a
 * local testnet bootstrap instead of the public one.
 */
export class Transport {
  private readonly node: any;
  private server: any;
  private readonly peers = new Map<string, { peer: Peer; socket: any }>();

  constructor(
    private readonly keyPair: { publicKey: Buffer; secretKey: Buffer },
    private readonly allow: Allowlist,
    private readonly handlers: TransportHandlers,
    dhtOptions?: unknown,
  ) {
    this.node = new DHT(dhtOptions);
  }

  async listen(): Promise<void> {
    this.server = this.node.createServer();
    this.server.on("connection", (socket: any) => this.onConnection(socket));
    await this.server.listen(this.keyPair);
  }

  private onConnection(socket: any): void {
    // Reload allowlist from disk so admin API changes take effect without restart.
    this.allow.load();
    const remoteKey: string = socket.remotePublicKey ? socket.remotePublicKey.toString("hex") : "";

    if (!remoteKey || !this.allow.has(remoteKey)) {
      this.handlers.log(`rejected un-paired peer ${shortKey(remoteKey)}`);
      socket.destroy();
      return;
    }

    const id = randomUUID();
    const peer: Peer = {
      id,
      remoteKey,
      send: (msg) => {
        try {
          socket.write(encode(msg));
        } catch (err) {
          // Surface the failure to the consumer; 'close' still tears down the peer.
          this.handlers.log(`write to peer ${shortKey(remoteKey)} failed: ${(err as Error)?.message ?? err}`);
        }
      },
    };
    this.peers.set(id, { peer, socket });

    const decode = createLineDecoder((obj) => this.handlers.onMessage(peer, obj as InboundMessage));
    socket.on("data", decode);
    socket.on("error", () => {
      /* swallow; 'close' handles teardown */
    });
    socket.once("close", () => {
      this.peers.delete(id);
      this.handlers.onDisconnect(peer);
    });

    this.handlers.onConnect(peer);
  }

  broadcast(msg: OutboundMessage): void {
    for (const { peer } of this.peers.values()) peer.send(msg);
  }

  peerCount(): number {
    return this.peers.size;
  }

  connectedKeys(): string[] {
    return [...this.peers.values()].map((p) => p.peer.remoteKey);
  }

  connectedPeers(): Peer[] {
    return [...this.peers.values()].map((p) => p.peer);
  }

  disconnectKey(remoteKey: string): number {
    const normalized = remoteKey.toLowerCase();
    let disconnected = 0;
    for (const { peer, socket } of this.peers.values()) {
      if (peer.remoteKey !== normalized) continue;
      disconnected++;
      try {
        socket.destroy();
      } catch {
        /* close handles teardown */
      }
    }
    return disconnected;
  }

  async destroy(): Promise<void> {
    for (const { socket } of this.peers.values()) {
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
    }
    this.peers.clear();
    try {
      await this.server?.close();
    } catch {
      /* ignore */
    }
    try {
      await this.node.destroy();
    } catch {
      /* ignore */
    }
  }
}
