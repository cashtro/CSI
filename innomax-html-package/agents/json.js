// Robust JSON out of model text, plus tiny hand-written schema validation.
//
// extractJson: a ```json fenced block first, otherwise the first balanced
// {...} or [...] (string- and escape-aware).
// validate: { type, required, properties, items, enum, min, max, minItems,
// maxItems, maxLength } — just enough for the Council phases.
// askJson: calls the model, and if the answer does not parse or validate,
// asks again once with the errors and a correction instruction.

class JsonValidationError extends Error {
  constructor(message, errors = [], raw = '') {
    super(message);
    this.name = 'JsonValidationError';
    this.errors = errors;
    this.raw = raw;
  }
}

function balancedSlice(text, start) {
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === open) depth += 1;
    else if (c === close) {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function extractJson(text) {
  if (typeof text !== 'string' || !text.trim()) throw new JsonValidationError('Réponse vide', ['réponse vide']);
  const fence = /```(?:json)?\s*\n?([\s\S]*?)```/i.exec(text);
  if (fence) {
    try { return JSON.parse(fence[1].trim()); } catch (_) { /* fall through to scanning */ }
  }
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== '{' && text[i] !== '[') continue;
    const slice = balancedSlice(text, i);
    if (!slice) break;
    try { return JSON.parse(slice); } catch (_) { /* try the next opening brace */ }
  }
  throw new JsonValidationError('Aucun JSON valide trouvé', ['aucun objet JSON valide trouvé dans la réponse'], text);
}

function typeOf(v) {
  if (Array.isArray(v)) return 'array';
  if (v === null) return 'null';
  if (typeof v === 'number' && Number.isFinite(v)) return 'number';
  return typeof v;
}

function validate(schema, value, path = '$') {
  const errors = [];
  if (!schema) return errors;
  const t = typeOf(value);
  if (schema.type && schema.type !== t) {
    errors.push(`${path}: attendu ${schema.type}, reçu ${t}`);
    return errors;
  }
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: doit être l'une de ${schema.enum.join(', ')}`);
  if (t === 'number') {
    if (schema.min != null && value < schema.min) errors.push(`${path}: doit être >= ${schema.min}`);
    if (schema.max != null && value > schema.max) errors.push(`${path}: doit être <= ${schema.max}`);
  }
  if (t === 'string') {
    if (schema.minLength != null && value.trim().length < schema.minLength) errors.push(`${path}: texte trop court`);
    if (schema.maxLength != null && value.length > schema.maxLength) errors.push(`${path}: texte trop long (max ${schema.maxLength})`);
  }
  if (t === 'array') {
    if (schema.minItems != null && value.length < schema.minItems) errors.push(`${path}: au moins ${schema.minItems} élément(s)`);
    if (schema.maxItems != null && value.length > schema.maxItems) errors.push(`${path}: au plus ${schema.maxItems} élément(s)`);
    if (schema.items) value.forEach((v, i) => errors.push(...validate(schema.items, v, `${path}[${i}]`)));
  }
  if (t === 'object') {
    for (const key of schema.required || []) {
      if (value[key] === undefined) errors.push(`${path}.${key}: champ requis manquant`);
    }
    for (const [key, sub] of Object.entries(schema.properties || {})) {
      if (value[key] !== undefined) errors.push(...validate(sub, value[key], `${path}.${key}`));
    }
  }
  return errors;
}

function parseAndValidate(text, schema) {
  const value = extractJson(text);
  const errors = validate(schema, value);
  if (errors.length) throw new JsonValidationError('JSON invalide', errors, text);
  return value;
}

function correctionPrompt(errors) {
  return [
    'Ta réponse précédente ne respecte pas le format demandé :',
    ...errors.slice(0, 15).map((e) => `- ${e}`),
    'Réponds de nouveau avec UNIQUEMENT un objet JSON valide qui respecte exactement le schéma demandé, sans texte autour.',
  ].join('\n');
}

// llm: { complete({ tier, system, messages }) } -> { text, ... }
// Returns { value, calls: [completion results] }.
async function askJson(llm, { tier, model, system, prompt, schema, maxCorrections = 1 }) {
  const messages = [{ role: 'user', content: prompt }];
  const calls = [];
  for (let round = 0; round <= maxCorrections; round += 1) {
    const out = await llm.complete({ tier, model, system, messages });
    calls.push(out);
    try {
      return { value: parseAndValidate(out.text, schema), calls };
    } catch (err) {
      if (!(err instanceof JsonValidationError) || round === maxCorrections) {
        if (err instanceof JsonValidationError) err.calls = calls;
        throw err;
      }
      messages.push({ role: 'assistant', content: out.text || '(vide)' });
      messages.push({ role: 'user', content: correctionPrompt(err.errors) });
    }
  }
  /* istanbul ignore next */
  throw new JsonValidationError('unreachable');
}

module.exports = { extractJson, validate, parseAndValidate, askJson, correctionPrompt, JsonValidationError };
