import { DEMO_TOOLS } from '../catalog/demo/demo.connector.js';
import { validateToolArgs } from './tool-args.js';

const search = DEMO_TOOLS[0].parameters;

describe('validateToolArgs', () => {
  it('accepts valid arguments', () => {
    expect(
      validateToolArgs(search, { query: 'deel', maxPrice: 300000 }),
    ).toEqual({
      ok: true,
      args: { query: 'deel', maxPrice: 300000 },
    });
  });

  it('coerces numeric strings and drops undeclared keys', () => {
    expect(
      validateToolArgs(search, {
        query: 'deel',
        maxPrice: '300,000₮',
        discount: '90%',
      }),
    ).toEqual({ ok: true, args: { query: 'deel', maxPrice: 300000 } });
  });

  it.each([
    [null, 'Arguments must be a JSON object.'],
    [{}, 'Missing required argument "query".'],
    [{ query: 42 }, 'Argument "query" must be of type string.'],
    [
      { query: 'x', maxPrice: 'cheap' },
      'Argument "maxPrice" must be of type integer.',
    ],
    [
      { query: 'x', maxPrice: 1.5 },
      'Argument "maxPrice" must be of type integer.',
    ],
  ])('rejects %j', (args, error) => {
    expect(validateToolArgs(search, args)).toEqual({ ok: false, error });
  });

  it('checks enums and keeps extras when allowed', () => {
    const schema = {
      type: 'object',
      properties: { status: { type: 'string', enum: ['open', 'closed'] } },
    };
    expect(validateToolArgs(schema, { status: 'gone' })).toEqual({
      ok: false,
      error: 'Argument "status" must be one of: open, closed.',
    });
    expect(validateToolArgs(schema, { status: 'open', note: 'x' })).toEqual({
      ok: true,
      args: { status: 'open', note: 'x' },
    });
  });
});
