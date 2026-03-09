import type { AnySchemaObject } from 'ajv';

export { isObject, resolveRefTarget, resolveJsonPointer, decodeJsonPointerToken };

interface ResolvedSchema {
  schema: AnySchemaObject;
  rootSchema: AnySchemaObject;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function decodeJsonPointerToken(token: string): string {
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

function resolveJsonPointer(root: AnySchemaObject, pointer: string, fullRef: string): AnySchemaObject {
  if (pointer === '') return root;
  if (!pointer.startsWith('/')) {
    throw new Error(`Unsupported $ref pointer "${fullRef}". Expected a JSON pointer (e.g. "#/$defs/name").`);
  }

  let current: unknown = root;
  for (const rawToken of pointer.slice(1).split('/')) {
    const token = decodeJsonPointerToken(rawToken);

    if (Array.isArray(current)) {
      const index = Number.parseInt(token, 10);
      if (Number.isNaN(index) || index < 0 || index >= current.length) {
        throw new Error(`Cannot resolve $ref "${fullRef}": array index "${token}" is out of bounds.`);
      }
      current = current[index];
      continue;
    }

    if (!isObject(current) || !(token in current)) {
      throw new Error(`Cannot resolve $ref "${fullRef}": token "${token}" does not exist.`);
    }

    current = current[token];
  }

  if (!isObject(current)) {
    throw new Error(`Cannot resolve $ref "${fullRef}": target is not an object schema.`);
  }

  return current as AnySchemaObject;
}

function mergeSchemaObjects(base: AnySchemaObject, overlay: AnySchemaObject): AnySchemaObject {
  const merged = { ...base, ...overlay } as Record<string, unknown>;

  const baseProps = isObject(base.properties) ? (base.properties as Record<string, AnySchemaObject>) : undefined;
  const overlayProps = isObject(overlay.properties)
    ? (overlay.properties as Record<string, AnySchemaObject>)
    : undefined;
  if (baseProps || overlayProps) {
    merged.properties = {
      ...(baseProps ?? {}),
      ...(overlayProps ?? {}),
    };
  }

  const baseRequired = asArray<string>(base.required);
  const overlayRequired = asArray<string>(overlay.required);
  if (baseRequired.length > 0 || overlayRequired.length > 0) {
    merged.required = [...new Set([...baseRequired, ...overlayRequired])];
  }

  const baseAllOf = asArray<AnySchemaObject>(base.allOf);
  const overlayAllOf = asArray<AnySchemaObject>(overlay.allOf);
  if (baseAllOf.length > 0 || overlayAllOf.length > 0) {
    merged.allOf = [...baseAllOf, ...overlayAllOf];
  }

  return merged as AnySchemaObject;
}

function resolveRefTarget(
  ref: string,
  currentRootSchema: AnySchemaObject,
  registry: Map<string, AnySchemaObject>,
): { schema: AnySchemaObject; rootSchema: AnySchemaObject; refKey: string } {
  if (ref.startsWith('#')) {
    const pointer = ref.slice(1);
    const rootId = typeof currentRootSchema.$id === 'string' ? currentRootSchema.$id : '(root)';
    return {
      schema: resolveJsonPointer(currentRootSchema, pointer, ref),
      rootSchema: currentRootSchema,
      refKey: `${rootId}#${pointer}`,
    };
  }

  const hashIndex = ref.indexOf('#');
  const baseId = hashIndex >= 0 ? ref.slice(0, hashIndex) : ref;
  const pointer = hashIndex >= 0 ? ref.slice(hashIndex + 1) : '';

  const externalSchema = registry.get(baseId);
  if (!externalSchema) {
    throw new Error(`Cannot resolve external $ref: ${ref}`);
  }

  return {
    schema: resolveJsonPointer(externalSchema, pointer, ref),
    rootSchema: externalSchema,
    refKey: `${baseId}#${pointer}`,
  };
}

function resolveRefWithContext(
  def: AnySchemaObject | undefined,
  rootSchema: AnySchemaObject,
  registry: Map<string, AnySchemaObject>,
  stack: Set<string>,
): ResolvedSchema | undefined {
  if (!def) return undefined;
  const ref = typeof def.$ref === 'string' ? def.$ref : undefined;
  if (!ref) {
    return { schema: def, rootSchema };
  }

  const target = resolveRefTarget(ref, rootSchema, registry);
  if (stack.has(target.refKey)) {
    throw new Error(`Cyclic $ref detected: ${[...stack, target.refKey].join(' -> ')}`);
  }

  stack.add(target.refKey);
  const resolvedTarget = resolveRefWithContext(target.schema, target.rootSchema, registry, stack);
  stack.delete(target.refKey);

  if (!resolvedTarget) return undefined;

  const overlay: Record<string, unknown> = {};
  let hasOverlay = false;
  for (const [k, v] of Object.entries(def)) {
    if (k !== '$ref') {
      overlay[k] = v;
      hasOverlay = true;
    }
  }

  if (!hasOverlay) {
    return resolvedTarget;
  }

  return {
    schema: mergeSchemaObjects(resolvedTarget.schema, overlay as AnySchemaObject),
    rootSchema: resolvedTarget.rootSchema,
  };
}

function flattenAllOf(
  def: AnySchemaObject | undefined,
  rootSchema: AnySchemaObject,
  registry: Map<string, AnySchemaObject>,
  stack: Set<string>,
  visited = new Set<string>(),
): ResolvedSchema[] {
  const resolved = resolveRefWithContext(def, rootSchema, registry, stack);
  if (!resolved) return [];

  const schemaId = typeof resolved.schema.$id === 'string' ? resolved.schema.$id : undefined;
  if (schemaId && visited.has(schemaId)) {
    // Cycle detected via allOf: this schema is already being processed
    return [];
  }
  if (schemaId) visited.add(schemaId);

  const parts: ResolvedSchema[] = [];
  const allOf = asArray<AnySchemaObject>(resolved.schema.allOf);
  for (const sub of allOf) {
    parts.push(...flattenAllOf(sub, resolved.rootSchema, registry, stack, visited));
  }

  if (schemaId) visited.delete(schemaId);

  const own = { ...resolved.schema } as Record<string, unknown>;
  delete own.allOf;
  parts.push({ schema: own as AnySchemaObject, rootSchema: resolved.rootSchema });
  return parts;
}

/**
 * Resolve a schema definition, following cross-file and internal refs transitively.
 */
export function resolveRef(
  propDef: AnySchemaObject | undefined,
  schema: AnySchemaObject,
  registry: Map<string, AnySchemaObject>,
): AnySchemaObject | undefined {
  return resolveRefWithContext(propDef, schema, registry, new Set())?.schema;
}

/**
 * Merge properties and required fields from allOf entries recursively across refs.
 * allOf entries are flattened depth-first; direct properties on later fragments override earlier ones.
 */
export function mergeVariantProperties(
  variant: AnySchemaObject,
  schema: AnySchemaObject,
  registry: Map<string, AnySchemaObject>,
): { properties: Record<string, AnySchemaObject>; required: string[] } {
  const properties: Record<string, AnySchemaObject> = {};
  const requiredSet = new Set<string>();
  const fragments = flattenAllOf(variant, schema, registry, new Set());

  for (const fragment of fragments) {
    const fragmentProps = isObject(fragment.schema.properties)
      ? (fragment.schema.properties as Record<string, AnySchemaObject>)
      : undefined;

    if (fragmentProps) {
      for (const [key, value] of Object.entries(fragmentProps)) {
        properties[key] = resolveRef(value as AnySchemaObject, fragment.rootSchema, registry) ?? value;
      }
    }

    for (const req of asArray<string>(fragment.schema.required)) {
      requiredSet.add(req);
    }
  }

  return { properties, required: [...requiredSet] };
}
