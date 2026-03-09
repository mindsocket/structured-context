import { statSync } from 'node:fs';
import { loadConfig, resolveSpacePath, updateSpaceField } from '../config';
import { readSpaceDirectory } from '../read-space-directory';
import { readSpaceOnAPage } from '../read-space-on-a-page';
import type { SpaceNode } from '../types';
import { computeMiroCardHash, computeNodeHash, loadCache, saveCache } from './cache';
import { MiroClient, MiroNotFoundError } from './client';
import { CARD_WIDTH, layoutNewCards } from './layout';
import { buildCardDescription, buildCardTitle, getCardColor } from './styles';

interface SyncOptions {
  newFrame?: string;
  dryRun?: boolean;
  verbose?: boolean;
}

export async function miroSync(spaceOrPath: string, options: SyncOptions): Promise<void> {
  const token = process.env.MIRO_TOKEN;
  if (!token) {
    console.error('MIRO_TOKEN environment variable is required');
    process.exit(1);
  }

  // 1. Resolve space and board
  const config = loadConfig();
  const space = config.spaces.find((s) => s.name === spaceOrPath);

  if (!space) {
    console.error(
      `"${spaceOrPath}" is not a known space name. miro-sync requires a configured space with miroBoardId.`,
    );
    process.exit(1);
  }

  if (!space.miroBoardId) {
    console.error(`No miroBoardId configured for space "${space.name}".`);
    console.error('Add miroBoardId to the space entry in config.');
    process.exit(1);
  }

  const boardId = space.miroBoardId;

  // 2. Resolve frame
  if (!space.miroFrameId && !options.newFrame) {
    console.error('No miroFrameId in space config. Pass --new-frame "Title" to create one.');
    process.exit(1);
  }

  // 3. Load space nodes (load before creating frame so we can calculate size)
  const resolvedPath = resolveSpacePath(spaceOrPath, config);
  let nodes: SpaceNode[];

  if (statSync(resolvedPath).isFile()) {
    ({ nodes } = readSpaceOnAPage(resolvedPath));
  } else {
    ({ nodes } = await readSpaceDirectory(resolvedPath));
  }

  if (nodes.length === 0) {
    console.log('No space nodes found.');
    return;
  }

  const client = new MiroClient(boardId, token);
  let frameId: string;
  let layoutOffset: { x: number; y: number } | null = null;

  if (options.newFrame) {
    // Calculate layout bounds to size the frame appropriately
    const { bounds } = layoutNewCards(nodes, new Map());
    const frameWidth = Math.max(1600, bounds.maxX - bounds.minX);
    const frameHeight = Math.max(1200, bounds.maxY - bounds.minY);

    // Miro positions child items relative to the parent frame's top-left corner.
    // We shift card positions so the layout bounds start at (0, 0) in frame-local space.
    layoutOffset = {
      x: -bounds.minX,
      y: -bounds.minY,
    };

    // Add padding around the calculated bounds for visual breathing room
    const padding = 200;
    const finalFrameWidth = frameWidth + padding * 2;
    const finalFrameHeight = frameHeight + padding * 2;

    if (options.dryRun) {
      console.log(`[dry-run] Would create frame: "${options.newFrame}" (size: ${finalFrameWidth}x${finalFrameHeight})`);
      frameId = 'dry-run-frame-id';
    } else {
      const frame = await client.createFrame({
        data: { title: options.newFrame, type: 'freeform' },
        position: { x: 0, y: 0, origin: 'center' },
        geometry: { width: finalFrameWidth, height: finalFrameHeight },
      });
      frameId = frame.id;
      console.log(`Created frame "${options.newFrame}" (${frameId}) - size: ${finalFrameWidth}x${finalFrameHeight}`);
      updateSpaceField(space.name, 'miroFrameId', frameId);
      console.log(`Saved miroFrameId to config`);
    }
  } else {
    frameId = space.miroFrameId!;
  }

  // 4. Load cache
  const cache = loadCache(boardId, frameId);
  cache.spaceName = space.name;

  // 5. Verify cache against actual board state
  // Fetch all cards from the frame to build a verified mapping
  const existingPositions = new Map<string, { x: number; y: number }>();
  const verifiedCardIds = new Map<string, string>(); // title → cardId (only cards that exist on board)
  const miroCardData = new Map<string, { title: string; description: string }>(); // cardId → actual Miro data
  const staleCacheEntries: string[] = []; // titles with cached card IDs that no longer exist

  const frameItems = await client.getItemsInFrame(frameId);
  const boardCardIds = new Set<string>();

  for (const item of frameItems) {
    if (item.type === 'card' && item.position && item.data) {
      boardCardIds.add(item.id);
      miroCardData.set(item.id, {
        title: item.data.title,
        description: item.data.description ?? '',
      });
      // Find which cached node this card belongs to
      for (const [title, cached] of Object.entries(cache.nodes)) {
        if (cached.miroCardId === item.id) {
          existingPositions.set(title, {
            x: item.position.x,
            y: item.position.y,
          });
          verifiedCardIds.set(title, item.id);
        }
      }
    }
  }

  // Detect stale cache entries (cached card IDs not on board)
  for (const [title, cached] of Object.entries(cache.nodes)) {
    if (!boardCardIds.has(cached.miroCardId)) {
      staleCacheEntries.push(title);
    }
  }

  if (staleCacheEntries.length > 0) {
    if (options.verbose || options.dryRun) {
      console.log(`Found ${staleCacheEntries.length} stale cache entries (cards deleted from board)`);
      for (const title of staleCacheEntries) {
        console.log(`  - "${title}" (will recreate)`);
      }
    }
  }

  // 6. Determine which nodes are new vs updated vs unchanged
  // Compare actual Miro card content against markdown (not cached hash)
  const newNodes: SpaceNode[] = [];
  const updatedNodes: { node: SpaceNode; cardId: string }[] = [];
  let skippedCount = 0;

  for (const node of nodes) {
    const title = node.schemaData.title as string;
    // Compute what we expect to be in Miro (using the same build functions)
    const expectedTitle = buildCardTitle(node);
    const expectedDesc = buildCardDescription(node);
    const expectedHash = computeMiroCardHash(expectedTitle, expectedDesc);

    // Check if there's a verified card on the board for this node
    const verifiedCardId = verifiedCardIds.get(title);

    if (!verifiedCardId) {
      // No card on board - needs to be created
      newNodes.push(node);
    } else {
      // Card exists - compare actual Miro content against expected markdown content
      const miroData = miroCardData.get(verifiedCardId);
      if (miroData) {
        const miroHash = computeMiroCardHash(miroData.title, miroData.description);
        if (miroHash !== expectedHash) {
          // Miro content differs from markdown - needs update
          if (options.verbose) {
            console.log(`"${title}" differs from Miro:`);
            console.log(`  Expected: "${JSON.stringify(expectedTitle)}"`);
            console.log(`  Miro has: "${JSON.stringify(miroData.title)}"`);
            console.log(`  Expected desc: "${JSON.stringify(expectedDesc)}"`);
            console.log(`  Miro desc: "${JSON.stringify(miroData.description)}"`);
          }
          updatedNodes.push({ node, cardId: verifiedCardId });
        } else {
          skippedCount++;
        }
      } else {
        // Card ID exists but we couldn't fetch data - recreate
        newNodes.push(node);
      }
    }
  }

  // Compute positions for new cards
  const { positions: newPositions } = layoutNewCards(newNodes, existingPositions);

  // 7. Create new cards
  let createdCount = 0;
  for (const node of newNodes) {
    const title = node.schemaData.title as string;
    const type = node.schemaData.type as string;
    let pos = newPositions.get(title) ?? { x: 0, y: 0 };

    // Apply offset if we created a new frame (to center layout in frame)
    if (layoutOffset) {
      pos = { x: pos.x + layoutOffset.x, y: pos.y + layoutOffset.y };
    } else {
      // For existing frames without layout offset, place at origin for simplicity
      // User can manually rearrange or re-sync with --new-frame for better layout
      pos = { x: 0, y: 0 };
    }

    if (options.dryRun) {
      console.log(`[dry-run] Create card: "${title}" (${type}) at (${pos.x}, ${pos.y})`);
      // For dry-run, use a fake ID so connectors can be calculated
      verifiedCardIds.set(title, `dry-run-card-${title}`);
      createdCount++;
      continue;
    }

    if (options.verbose) console.log(`Creating card: "${title}" (${type}) at (${pos.x}, ${pos.y})`);

    const card = await client.createCard({
      data: {
        title: buildCardTitle(node),
        description: buildCardDescription(node),
      },
      style: { cardTheme: getCardColor(type) },
      position: { x: pos.x, y: pos.y, origin: 'center' },
      parent: { id: frameId },
      geometry: { width: CARD_WIDTH },
    });

    cache.nodes[title] = {
      miroCardId: card.id,
      contentHash: computeNodeHash(node),
    };
    verifiedCardIds.set(title, card.id); // Add to verified set so connectors can use it
    createdCount++;
  }

  // 8. Update changed cards
  let updatedCount = 0;
  for (const { node, cardId } of updatedNodes) {
    const title = node.schemaData.title as string;

    if (options.dryRun) {
      console.log(`[dry-run] Update card: "${title}"`);
      updatedCount++;
      continue;
    }

    if (options.verbose) console.log(`Updating card: "${title}"`);

    try {
      await client.updateCard(cardId, {
        data: {
          title: buildCardTitle(node),
          description: buildCardDescription(node),
        },
      });
      cache.nodes[title] = {
        miroCardId: cardId,
        contentHash: computeNodeHash(node),
      };
      updatedCount++;
    } catch (e) {
      if (e instanceof MiroNotFoundError) {
        // Card was deleted from Miro — recreate it
        console.log(`Card "${title}" missing from Miro, recreating...`);
        const type = node.schemaData.type as string;
        const card = await client.createCard({
          data: {
            title: buildCardTitle(node),
            description: buildCardDescription(node),
          },
          style: { cardTheme: getCardColor(type) },
          position: { x: 0, y: 0, origin: 'center' },
          parent: { id: frameId },
          geometry: { width: CARD_WIDTH },
        });
        cache.nodes[title] = {
          miroCardId: card.id,
          contentHash: computeNodeHash(node),
        };
        createdCount++;
      } else {
        throw e;
      }
    }
  }

  // 9. Sync connectors
  const prefix = options.dryRun ? '[dry-run] ' : '';
  let connectorsCreated = 0;
  let connectorsDeleted = 0;

  // Build desired parent→child pairs from OST data
  // Only include edges where both endpoints have verified cards on the board
  const desiredEdges = new Map<string, { parentTitle: string; childTitle: string }>();
  for (const node of nodes) {
    const childTitle = node.schemaData.title as string;
    for (const parentTitle of node.resolvedParents) {
      // Both endpoints must have verified cards on the board
      if (verifiedCardIds.has(parentTitle) && verifiedCardIds.has(childTitle)) {
        const key = `${parentTitle}\u2192${childTitle}`;
        desiredEdges.set(key, { parentTitle, childTitle });
      }
    }
  }

  // Build cardId → title mapping from VERIFIED cards only
  const cardIdToTitle = new Map<string, string>();
  for (const [title, cardId] of verifiedCardIds.entries()) {
    cardIdToTitle.set(cardId, title);
  }

  // Find existing connectors that we created (from cache)
  const existingConnectorIds = new Set(Object.values(cache.connectors).map((c) => c.miroConnectorId));

  // Verify our cached connectors still exist and connect our cards
  const allConnectors = await client.getConnectors();
  const validCachedEdges = new Map<string, string>(); // edge key → connector ID
  for (const conn of allConnectors) {
    // Skip connectors not in our cache
    if (!existingConnectorIds.has(conn.id)) continue;
    // Skip connectors that don't connect two items
    if (!conn.startItem || !conn.endItem) continue;

    const startTitle = cardIdToTitle.get(conn.startItem.id);
    const endTitle = cardIdToTitle.get(conn.endItem.id);
    if (startTitle && endTitle) {
      validCachedEdges.set(`${startTitle}\u2192${endTitle}`, conn.id);
    }
  }

  // Create missing connectors
  for (const [key, { parentTitle, childTitle }] of desiredEdges) {
    if (!validCachedEdges.has(key)) {
      if (options.verbose || options.dryRun)
        console.log(`${prefix}Creating connector: ${parentTitle} -> ${childTitle}`);
      if (!options.dryRun) {
        const conn = await client.createConnector(verifiedCardIds.get(parentTitle)!, verifiedCardIds.get(childTitle)!);
        cache.connectors[key] = { miroConnectorId: conn.id };
      }
      connectorsCreated++;
    }
  }

  // Delete ONLY connectors we created that are no longer valid
  for (const [key, cached] of Object.entries(cache.connectors)) {
    // Skip if this edge is still desired
    if (desiredEdges.has(key)) continue;

    // Check if the connector still exists in Miro and connects our cards
    if (validCachedEdges.has(key)) {
      if (options.verbose || options.dryRun) console.log(`${prefix}Deleting stale connector: ${key}`);
      if (!options.dryRun) {
        await client.deleteConnector(cached.miroConnectorId);
        connectorsDeleted++;
      }
    }

    // Remove from cache regardless (it's either deleted or invalid)
    if (!options.dryRun) {
      delete cache.connectors[key];
    }
  }

  // 10. Save cache
  cache.lastSync = new Date().toISOString();
  if (!options.dryRun) saveCache(cache);

  // Summary
  console.log(`\n${prefix}Sync complete:`);
  console.log(`  Cards: ${createdCount} created, ${updatedCount} updated, ${skippedCount} unchanged`);
  console.log(`  Connectors: ${connectorsCreated} created, ${connectorsDeleted} deleted`);
}
