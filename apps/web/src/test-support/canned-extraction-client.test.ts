import { describe, expect, it } from 'vitest';
import { classifyPage } from '@escape-the-crypt/core';
import { CANNED_PAGES } from './canned-extraction-client';

describe('canned extraction pages', () => {
  it('cover one ok, one low-text and one suspicious page, as the Page Checker sees them', () => {
    expect(CANNED_PAGES.map((p) => classifyPage(p.text))).toEqual(['ok', 'low-text', 'suspicious']);
  });
  it('have printed labels that differ from their page numbers', () => {
    CANNED_PAGES.forEach((p, i) => expect(p.label).not.toBe(String(i + 1)));
  });
});