// Gera slugs legíveis (ex.: "SUPRIMENTOS" -> "suprimentos") para usar como
// segmento de URL no lugar de `?scope=space&scopeId=<uuid>`. Usado por
// App.tsx (parseNavPath/computeNavPath) para espaços, pastas e listas.
const DIACRITICS_RE = /[̀-ͯ]/g;

export function slugify(input: string): string {
  const slug = input
    .normalize('NFD')
    .replace(DIACRITICS_RE, '') // remove acentos (marcas diacríticas combinantes, pós-NFD)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'item';
}

export interface SlugIndex {
  idToSlug: Map<string, string>;
  // Chave composta `${groupKey} ${slug}` — permite que o mesmo slug se
  // repita em grupos diferentes (ex.: duas pastas "Geral" em espaços
  // diferentes) sem colidir, já que o path final já as distingue pelo prefixo.
  slugToId: Map<string, string>;
}

// Constrói um índice slug<->id colisão-segura: nomes duplicados DENTRO do
// mesmo grupo (mesmo espaço, no caso de pastas; mesma pasta, no caso de
// listas) ganham sufixo numérico (-2, -3, ...). `getGroupKey` omitido = um
// único grupo global (usado para espaços, que não têm um "pai" a distinguir).
export function buildSlugIndex<T>(
  items: T[],
  getId: (item: T) => string,
  getName: (item: T) => string,
  getGroupKey?: (item: T) => string,
): SlugIndex {
  const idToSlug = new Map<string, string>();
  const slugToId = new Map<string, string>();
  const usedInGroup = new Map<string, Set<string>>();

  for (const item of items) {
    const id = getId(item);
    const group = getGroupKey ? getGroupKey(item) : '';
    const base = slugify(getName(item));
    const used = usedInGroup.get(group) ?? new Set<string>();

    let candidate = base;
    let n = 2;
    while (used.has(candidate)) {
      candidate = `${base}-${n}`;
      n += 1;
    }

    used.add(candidate);
    usedInGroup.set(group, used);
    idToSlug.set(id, candidate);
    slugToId.set(`${group} ${candidate}`, id);
  }

  return { idToSlug, slugToId };
}
