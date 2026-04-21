const API_BASE = 'https://api.miro.com/v2';
const MAX_RETRIES = 3;

export interface MiroCard {
  id: string;
  type: 'card';
  data: { title: string; description?: string };
  style?: { cardTheme?: string };
  position?: { x: number; y: number };
  parent?: { id: string };
}

export interface MiroConnector {
  id: string;
  type: 'connector';
  startItem: { id: string };
  endItem: { id: string };
}

export interface MiroFrame {
  id: string;
  type: 'frame';
  data: { title: string };
}

interface MiroPagedResponse<T> {
  data: T[];
  cursor?: string;
  size: number;
}

export class MiroClient {
  private token: string;
  private boardId: string;

  constructor(boardId: string, token: string) {
    this.boardId = boardId;
    this.token = token;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${API_BASE}/boards/${this.boardId}${path}`;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get('Retry-After') ?? '2', 10);
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, retryAfter * 1000));
          continue;
        }
      }

      if (res.status === 404) {
        throw new MiroNotFoundError(`${method} ${path}: 404 Not Found`);
      }

      if (!res.ok) {
        const text = await res.text();
        lastError = new Error(`Miro API ${method} ${path}: ${res.status} ${text}`);
        if (attempt < MAX_RETRIES && res.status >= 500) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        throw lastError;
      }

      if (res.status === 204) return undefined as T;
      return (await res.json()) as T;
    }

    throw lastError ?? new Error('Max retries exceeded');
  }

  // Cards
  async createCard(payload: {
    data: { title: string; description?: string };
    style?: { cardTheme?: string };
    position?: { x: number; y: number; origin?: string };
    parent?: { id: string };
    geometry?: { width?: number };
  }): Promise<MiroCard> {
    return this.request<MiroCard>('POST', '/cards', payload);
  }

  async updateCard(
    id: string,
    payload: {
      data?: { title?: string; description?: string };
      style?: { cardTheme?: string };
    },
  ): Promise<MiroCard> {
    return this.request<MiroCard>('PATCH', `/cards/${id}`, payload);
  }

  async getCard(id: string): Promise<MiroCard> {
    return this.request<MiroCard>('GET', `/cards/${id}`);
  }

  // Connectors
  async createConnector(
    startId: string,
    endId: string,
    style?: {
      strokeColor?: string;
      strokeStyle?: string;
      strokeWidth?: string;
    },
  ): Promise<MiroConnector> {
    return this.request<MiroConnector>('POST', '/connectors', {
      startItem: { id: startId, snapTo: 'auto' },
      endItem: { id: endId, snapTo: 'auto' },
      style,
    });
  }

  async getConnectors(): Promise<MiroConnector[]> {
    const items: MiroConnector[] = [];
    let cursor: string | undefined;
    do {
      const params = cursor ? `?cursor=${cursor}` : '';
      const res = await this.request<MiroPagedResponse<MiroConnector>>('GET', `/connectors${params}`);
      items.push(...res.data);
      cursor = res.cursor;
    } while (cursor);
    return items;
  }

  async deleteConnector(id: string): Promise<void> {
    await this.request<void>('DELETE', `/connectors/${id}`);
  }

  // Frames
  async createFrame(payload: {
    data: { title: string; type?: string };
    position?: { x: number; y: number; origin?: string };
    geometry?: { width?: number; height?: number };
  }): Promise<MiroFrame> {
    return this.request<MiroFrame>('POST', '/frames', payload);
  }

  async getFrames(): Promise<MiroFrame[]> {
    const items: MiroFrame[] = [];
    let cursor: string | undefined;
    do {
      const params = cursor ? `?cursor=${cursor}` : '';
      const res = await this.request<MiroPagedResponse<MiroFrame>>('GET', `/frames${params}`);
      items.push(...res.data);
      cursor = res.cursor;
    } while (cursor);
    return items;
  }

  async getFrame(frameId: string): Promise<MiroFrame | undefined> {
    const frames = await this.getFrames();
    return frames.find((f) => f.id === frameId);
  }

  // Items in frame
  async getItemsInFrame(frameId: string): Promise<MiroCard[]> {
    const items: MiroCard[] = [];
    let cursor: string | undefined;
    do {
      const params = new URLSearchParams({ parent_item_id: frameId });
      if (cursor) params.set('cursor', cursor);
      const res = await this.request<MiroPagedResponse<MiroCard>>('GET', `/items?${params}`);
      items.push(...res.data);
      cursor = res.cursor;
    } while (cursor);
    return items;
  }
}

export class MiroNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MiroNotFoundError';
  }
}
