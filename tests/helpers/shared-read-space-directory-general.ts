import type { Expect, Test } from 'bun:test';
import type { ParseResult } from '../../src/plugins/util';

export const defineValidSpaceTests = (it: Test<[]>, expect: Expect) => (getResult: () => ParseResult) => {};
