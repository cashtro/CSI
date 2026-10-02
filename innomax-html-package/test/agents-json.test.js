// agents/json.js: extraction, hand-written schema validation, correction retry.
require('./helpers/quiet');
const { extractJson, validate, askJson, JsonValidationError } = require('../agents/json');
const { SCHEMAS } = require('../agents/protocol');

describe('extractJson', () => {
  it('reads a ```json fenced block', () => {
    expect(extractJson('Voici :\n```json\n{"a": 1}\n```\nMerci')).toEqual({ a: 1 });
  });

  it('finds the first balanced object, ignoring braces inside strings', () => {
    expect(extractJson('Réponse : {"t": "un } piège {", "n": {"x": [1, 2]}} fin')).toEqual({ t: 'un } piège {', n: { x: [1, 2] } });
  });

  it('skips an unparsable brace and keeps scanning', () => {
    expect(extractJson('{pas du json} puis {"ok": true}')).toEqual({ ok: true });
  });

  it('throws a JsonValidationError when there is no JSON', () => {
    expect(() => extractJson('rien ici')).toThrow(JsonValidationError);
    expect(() => extractJson('')).toThrow(JsonValidationError);
  });
});

describe('validate', () => {
  it('accepts a valid vote', () => {
    expect(validate(SCHEMAS.vote, { vote: 'pour', confiance: 0.8, raison: 'r', condition: '' })).toEqual([]);
  });

  it('reports missing fields, wrong enums, ranges and types', () => {
    const errors = validate(SCHEMAS.vote, { vote: 'peut-être', confiance: 7, raison: 3 });
    expect(errors.join('\n')).toMatch(/condition: champ requis/);
    expect(errors.join('\n')).toMatch(/vote: doit être l'une de pour, contre/);
    expect(errors.join('\n')).toMatch(/confiance: doit être <= 1/);
    expect(errors.join('\n')).toMatch(/raison: attendu string/);
  });

  it('validates nested arrays of objects (objection gravite 1-5)', () => {
    const errors = validate(SCHEMAS.objections, { objections: [{ cible: 'P1', objection: 'x', gravite: 9 }], contre_proposition: 'y' });
    expect(errors).toEqual(['$.objections[0].gravite: doit être <= 5']);
  });
});

describe('askJson', () => {
  const schema = SCHEMAS.vote;
  it('asks again with a correction instruction when validation fails, then succeeds', async () => {
    const complete = jest.fn()
      .mockResolvedValueOnce({ text: '{"vote": "oui"}' })
      .mockResolvedValueOnce({ text: '{"vote": "pour", "confiance": 0.9, "raison": "ok", "condition": ""}' });
    const { value, calls } = await askJson({ complete }, { system: 's', prompt: 'p', schema });
    expect(value.vote).toBe('pour');
    expect(calls).toHaveLength(2);
    const second = complete.mock.calls[1][0].messages;
    expect(second).toHaveLength(3);
    expect(second[1]).toEqual({ role: 'assistant', content: '{"vote": "oui"}' });
    expect(second[2].role).toBe('user');
    expect(second[2].content).toMatch(/ne respecte pas le format/);
    expect(second[2].content).toMatch(/condition: champ requis/);
  });

  it('gives up after the allowed corrections', async () => {
    const complete = jest.fn().mockResolvedValue({ text: 'pas de JSON' });
    await expect(askJson({ complete }, { prompt: 'p', schema, maxCorrections: 1 })).rejects.toBeInstanceOf(JsonValidationError);
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('does not retry on non-JSON errors (e.g. budget)', async () => {
    const complete = jest.fn().mockRejectedValue(new Error('budget'));
    await expect(askJson({ complete }, { prompt: 'p', schema })).rejects.toThrow('budget');
    expect(complete).toHaveBeenCalledTimes(1);
  });
});
