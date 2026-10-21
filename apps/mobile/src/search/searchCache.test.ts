import assert from 'node:assert/strict';
import { SearchCache, matchRecentSearches } from './searchCache.ts';

// Gemmer og finder igen.
const c = new SearchCache<number>(2, 1000);
c.set('a', 1, 0);
assert.equal(c.get('a', 10), 1);

// Udløber efter TTL.
assert.equal(c.get('a', 2000), undefined);
assert.equal(c.size, 0);

// Smider den ældst brugte ud, ikke den ældst gemte.
c.set('a', 1, 0);
c.set('b', 2, 0);
c.get('a', 1);
c.set('c', 3, 2);
assert.equal(c.get('b', 3), undefined);
assert.equal(c.get('a', 3), 1);
assert.equal(c.get('c', 3), 3);

// Seneste søgninger der passer til det man skriver.
const recent = ['Mælk', 'Letmælk', 'hakket oksekød', 'mel'];
assert.deepEqual(matchRecentSearches(recent, 'mæ'), ['Mælk']);
assert.deepEqual(matchRecentSearches(recent, 'me'), ['mel']);
assert.deepEqual(matchRecentSearches(recent, 'okse'), ['hakket oksekød']);
assert.deepEqual(matchRecentSearches(recent, 'mælk'), []); // præcis det man har skrevet
assert.deepEqual(matchRecentSearches(recent, '  '), []);

console.log('searchCache: ok');
